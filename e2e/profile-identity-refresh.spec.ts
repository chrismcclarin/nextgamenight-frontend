import { test, expect, type Locator, type Page } from '@playwright/test';

/* Phase 88.6.1 plan 79 (AC-29 / D-51, RF1 / D-47; 88.6.1-70 contract C8 d) — the Profile header
   after a failed identity refresh, at 375px (`phone` project only), driven through the REAL
   failure path: an email-change answer the Email section cannot read makes it refetch the
   identity row (its drift arm), and that refetch fails.

   WHAT IT PROVES (what jsdom cannot):
   - Test 1 (a 500): the header keeps the name under the RF1 notice; its `Retry` is at least 44 x 44
     and inside the viewport width, the notice sits above the page heading, and nothing scrolls
     sideways.
   - Test 2 (a 401, an access answer): the page keeps its one level-1 heading above the full banner;
     `Try again` is at least 44 x 44 and inside the viewport width; nothing scrolls sideways.
   A failed layout assertion is a STOP for the owner's mockup (88.6.1-70 contract C8 d), never an
   ad-hoc restyle.

   NOTHING IS WRITTEN TO THE BACKEND. The email-change POST, the failing identity reads and the
   Sentry tunnel (`next.config.js`, `tunnelRoute: "/monitoring"`) are all answered in the browser;
   the only requests that reach the backend are the page's own first-load reads, as in every Profile
   e2e. The route helper FAILS CLOSED (review #126): every other non-GET to the API is aborted and
   counted, and each test ends asserting that count is 0.

   CI ONLY: the `phone` project needs `.auth/user.json` and the E2E login secrets, which exist only in
   CI (FE-TESTING-CONVENTIONS C-14). No screenshot and no attachment (DECISION 88.6-59). */

// Copy row RF1 (D-47, owner-ratified), declared once in this spec.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

interface IdentityRefreshArm {
  arm: () => void;
  emailPosts: () => number;
  aborted: () => number;
}

/** Spec-local, fail-closed routing for the identity refresh path. Call before `page.goto`. */
async function armIdentityRefresh(page: Page, failStatus: number): Promise<IdentityRefreshArm> {
  let failSelf = false;
  let emailPosts = 0;
  let aborted = 0;

  // Registered FIRST, so it is the last resort (Playwright tries the newest route first): every
  // GET continues; every other non-GET to the API is aborted and counted.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'GET' || method === 'HEAD') {
      await route.fallback();
      return;
    }
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      aborted += 1;
      await route.abort();
      return;
    }
    await route.fallback();
  });
  // (c) The Sentry tunnel: the drift arm's report and the query error report never leave CI.
  await page.route(
    (url) => url.pathname === '/monitoring',
    async (route) => {
      await route.fulfill({ status: 200, body: '' });
    },
  );
  // (b) The email-change POST: a 200 whose body the section cannot read, so its drift arm
  // refetches the identity row.
  await page.route(
    (url) => (failStatus === 500 ? /\/users\/[^/]+\/e-mail$/ : /\/users\/[^/]+\/email$/).test(url.pathname), // zz-plant-88.6.2-29 P-126a
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      emailPosts += 1;
      await route.fulfill({ status: 200, json: {} });
    },
  );
  // (a) The identity GET: through to the backend until armed, then the failure under test.
  await page.route(
    (url) => /\/users\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (!failSelf) {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: failStatus, json: { error: 'synthetic' } });
    },
  );

  return {
    arm: () => {
      failSelf = true;
    },
    emailPosts: () => emailPosts,
    aborted: () => aborted,
  };
}

async function startEmailChange(page: Page, routes: IdentityRefreshArm) {
  await page.goto('/userProfile');
  const h1 = page.getByRole('heading', { level: 1 });
  // Vacuity guards: the healthy page, no notice yet, the Email section in its idle arm.
  await expect(h1).toHaveCount(1);
  await expect(h1).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(RF1, { exact: true })).toHaveCount(0);
  const emailRegion = page.getByRole('region', { name: 'Email', exact: true });
  await expect(emailRegion.getByRole('button', { name: 'Change', exact: true })).toBeVisible();

  routes.arm();
  await emailRegion.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByLabel('New email address', { exact: true }).fill('refresh-check@example.com');
  await emailRegion.getByRole('button', { name: 'Save', exact: true }).click();
  // The POST took the fulfilled path, so everything after it is the path this spec claims to drive.
  await expect
    .poll(() => routes.emailPosts(), { message: 'the email-change POST was answered in the browser' })
    .toBeGreaterThanOrEqual(1);
}

async function expectFitsPhone(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box, 'the control has a layout box').not.toBeNull();
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth);
}

async function expectNoSidewaysScroll(page: Page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits, 'no sideways scroll at 375px').toBe(true);
}

test.describe('Profile identity refresh (88.6.1-79)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet requirements — phone project only');

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a failed identity refresh keeps the profile header under the RF1 notice (88.6.1-79)', async ({ page }) => {
    const routes = await armIdentityRefresh(page, 500);
    await startEmailChange(page, routes);

    const h1 = page.getByRole('heading', { level: 1 });
    const headerCard = page.locator('.card').filter({ has: h1 });
    // One retry under `shouldRetry` for a 500, so allow for it.
    const rf1Line = page.getByText(RF1, { exact: true }).and(page.locator('span'));
    await expect(rf1Line.first()).toBeVisible({ timeout: 15_000 });
    await expect(h1).toBeVisible();
    await expect(headerCard.getByText('Something went wrong', { exact: true })).toHaveCount(0);

    const retry = headerCard.getByRole('button', { name: 'Retry', exact: true });
    await expectFitsPhone(page, retry);
    const lineBox = await rf1Line.first().boundingBox();
    const headingBox = await h1.boundingBox();
    expect(lineBox && headingBox, 'both the notice and the heading have layout boxes').toBeTruthy();
    expect(lineBox!.y).toBeLessThan(headingBox!.y);
    await expectNoSidewaysScroll(page);

    expect(routes.aborted(), 'no unexpected write was attempted').toBe(0);
  });

  test('an access answer on the identity refresh keeps the page heading above the banner (88.6.1-79)', async ({ page }) => {
    const routes = await armIdentityRefresh(page, 401);
    await startEmailChange(page, routes);
    await page.evaluate(() => fetch('/api/zz-plant-88.6.2-29', { method: 'POST' }).catch(() => undefined)); // zz-plant-88.6.2-29 P-126b

    const h1 = page.getByRole('heading', { level: 1 });
    const headerCard = page.locator('.card').filter({ has: h1 });
    const tryAgain = headerCard.getByRole('button', { name: 'Try again', exact: true });
    await expect(tryAgain).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(RF1, { exact: true })).toHaveCount(0);
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();

    await expectFitsPhone(page, tryAgain);
    const headingBox = await h1.boundingBox();
    const tryAgainBox = await tryAgain.boundingBox();
    expect(headingBox && tryAgainBox, 'both the heading and Try again have layout boxes').toBeTruthy();
    expect(headingBox!.y).toBeLessThan(tryAgainBox!.y);
    await expectNoSidewaysScroll(page);

    expect(routes.aborted(), 'no unexpected write was attempted').toBe(0);
  });
});
