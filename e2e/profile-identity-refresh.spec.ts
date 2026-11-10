import { test, expect, type Locator, type Page, type Request } from '@playwright/test';

/* Phase 88.6.1 plan 79 (AC-29 / D-51, RF1 / D-47; 88.6.1-70 contract C8 d) — the Profile header
   after a failed identity refresh, at 375px (`phone` project only), driven through the REAL
   failure path: an email-change answer the Email section cannot read makes it refetch the
   identity row (its drift arm), and that refetch fails.

   WHAT IT PROVES (what jsdom cannot):
   - Test 1 (a 500): the header keeps the name under the RF1 notice; its `Retry` is at least 44 x 44
     and inside the viewport width, the notice sits above the page heading, and nothing scrolls
     sideways.
   - Test 2 (a 401, an access answer): the page keeps its one level-1 heading above the full banner;
     its Sign in link is at least 44 x 44 and inside the viewport width; nothing scrolls sideways.
     AMENDED Phase 88.9-26 (O22d): a 401 banner offers Sign in in place of Try again.
     AMENDED Phase 88.9-40 (SESSION-01, SPEC A8): a 401 on the identity read now sends the person to
     sign-in ONCE (the shared guard, src/lib/hooks/useSignInRedirect.ts), so test 2 drives the round
     trip in one tab: one sign-in request with /userProfile as returnTo, then the return visit after
     the session lapsed — the page-level banner with Sign in (at least 44 x 44, inside the viewport,
     nothing sideways) and no second request. The withdrawn header-card screen is pinned by the
     unit suite (userProfile K4 / K8, latch set) and is no longer what a refresh 401 shows.
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
    (url) => /\/users\/[^/]+\/email$/.test(url.pathname),
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

  // AMENDED Phase 88.9-26 (O22d): the 401 banner's control is a Sign in link in place of Try again,
  // so the 44 x 44 fit and the heading-above check move onto it, and Try again must be absent.
  // AMENDED Phase 88.9-40 (SESSION-01, SPEC A8): a 401 on the identity read now redirects once
  // (src/lib/hooks/useSignInRedirect.ts ("DECISION Phase 88.9-40 (SESSION-01, owner ruling")). The
  // page's healthy first load had proved the session (the latch was clear), so the refresh 401 is
  // exactly one sign-in request with /userProfile as returnTo, reaching Universal Login (CI on 584045a
  // showed exactly that: "navigated to /u/login" where this test waited for the banner). The return
  // visit is driven with the session LAPSED (cookies cleared): useUser answers no user, the latch is
  // set, so the guard declines and the page renders its signed-out banner with Sign in — the Sign in
  // control this test measured before, now on the return visit — with no second sign-in request (the
  // MC-6 latch survives the Auth0 round trip, as e2e/event-link-signed-out.spec.ts measures for the
  // event and group pages). A return with a LIVE cookie whose identity read still 401s shows the
  // no-row fallback (compact Retry notices, no Sign in) — recorded as a hand-off by plan 88.9-40.
  test('an access answer on the identity refresh signs in once, and the return visit offers Sign in at phone width (88.6.1-79, SESSION-01)', async ({ page }) => {
    const loginRequests: string[] = [];
    page.on('request', (req: Request) => {
      if (new URL(req.url()).pathname === '/api/auth/login') loginRequests.push(req.url());
    });
    const routes = await armIdentityRefresh(page, 401);
    await startEmailChange(page, routes);

    // The refresh 401: one latched replace to sign-in, the return address built from the location.
    await page.waitForURL(/\/u\/login|auth0\.com/, { timeout: 15_000 }).catch(() => {
      throw new Error(`Never reached Auth0 Universal Login — browser is at: ${page.url()}`);
    });
    expect(loginRequests, 'exactly one sign-in request').toHaveLength(1);
    expect(new URL(loginRequests[0]).searchParams.get('returnTo'), 'the return address is the profile').toBe(
      '/userProfile'
    );

    // Back in the SAME tab without signing in, the session having lapsed: the latch is set, so the
    // declined arm — the page's signed-out banner with Sign in — and no second request.
    await page.context().clearCookies();
    await page.goto('/userProfile');
    const signIn = page.getByRole('link', { name: 'Sign in', exact: true }).first();
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    await expect(signIn).toHaveAttribute('href', /^\/api\/auth\/login\?returnTo=%2FuserProfile/);
    await expect(page.getByText("We couldn't load your profile")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
    await expect(page.getByText(RF1, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Loading your profile...')).toBeHidden();
    expect(loginRequests, 'no second sign-in request after the round trip').toHaveLength(1);

    await expectFitsPhone(page, signIn);
    await expectNoSidewaysScroll(page);

    expect(routes.aborted(), 'no unexpected write was attempted').toBe(0);
  });
});
