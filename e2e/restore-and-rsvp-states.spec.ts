import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

// Phase 88.6.1 plan 36 — the two token landing pages' failure states, proven in a real browser
// (outline shared rule 9: the phone is the primary surface; the `phone` project is the iPhone SE
// preset, 375 x 667, and `journeys` runs the same tests at desktop width).
//
// What it proves:
// - RSVP magic-link page (`/rsvp/[token]`): a request that did not complete shows R3, and an
//   answer the page cannot use shows R9, by BOTH routes into the `internal` code — a page that
//   answers 200 with something that is not JSON (the parse-failure route), and the backend's own
//   JSON 500 (plan 88.6.1-23's status guard). Neither ever shows the advice to tap the link again,
//   and each fits the viewport with no horizontal scroll.
//
// Every test runs SIGNED OUT (an emailed link is opened by someone who may have no session).
// Every intercepted request is either ABORTED or answered by a synthesized `route.fulfill` built
// from a literal body — the spec never continues a route and never fetches one through, so
// nothing reaches the backend.
// Each route is registered BEFORE `page.goto` and matched by pathname. No real token is used.
// Assertion messages carry fixed strings only.
//
// CI-only: the `phone` and `journeys` projects need the `.auth/` state the CI `e2e` job creates
// (FE-TESTING-CONVENTIONS C-14); locally this file is typechecked and listed, never run.

const R3_DETAIL =
  "We couldn't confirm your RSVP — the connection timed out. Sign in and open the event to check your answer.";
const R9_DETAIL = "We couldn't confirm your RSVP. Sign in and open the event to check your answer.";
const RSVP_PATH = '/rsvp/e2e-not-a-real-rsvp-token?e=e2e-event&u=e2e-user&s=yes';

// CI serves the backend on another origin (`.github/workflows/ci.yml` sets
// `NEXT_PUBLIC_API_URL: http://localhost:4000/api` against the app's port 3000 in
// `playwright.config.ts`), so a faked answer needs an allow-origin header. Without it the browser
// blocks the answer, the fetch rejects as a network failure and the page shows R3 — an R9 test
// then fails on its R9 assertion; it never passes vacuously.
const CORS_HEADERS = { 'access-control-allow-origin': '*' };

test.use({ storageState: { cookies: [], origins: [] } });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** The element's right edge is inside the viewport. */
async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, 'the project must define a viewport').not.toBeNull();
  const box = await locator.boundingBox();
  expect(box, 'the element has no layout box').not.toBeNull();
  expect(box!.x + box!.width, 'the element runs past the right edge of the viewport').toBeLessThanOrEqual(
    viewport!.width,
  );
}

/** No page-level horizontal scroll. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth, 'the page scrolls horizontally').toBeLessThanOrEqual(widths.innerWidth);
}

/** Route the RSVP respond call to `handler`; every other request is untouched. */
async function routeRespond(page: Page, handler: (route: Route) => Promise<void>): Promise<void> {
  await page.route((url) => url.pathname.endsWith('/rsvp/respond'), handler);
}

/** The shared R9 assertions: the R9 line, no retap advice, no stated cause, the region, the fit. */
async function expectR9(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Something went wrong', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  const detail = page.getByText(R9_DETAIL, { exact: true });
  await expect(detail).toBeVisible();
  await expect(page.getByText(/try clicking the RSVP link/)).toHaveCount(0);
  await expect(page.getByText(/timed out/)).toHaveCount(0);
  // `toContainText`, never `toBeVisible`: the region is sr-only.
  await expect(page.getByTestId('rsvp-page-status')).toContainText(R9_DETAIL);
  await expectInsideViewport(page, detail);
  await expectNoHorizontalScroll(page);
}

test.describe('RSVP and restore token pages — failure states at phone width (88.6.1-36)', () => {
  test('A. RSVP: a request that did not complete shows R3, never the retap advice (88.6.1-36)', async ({
    page,
  }) => {
    await routeRespond(page, (route) => route.abort('timedout'));

    await page.goto(RSVP_PATH);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Something went wrong', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const detail = page.getByText(R3_DETAIL, { exact: true });
    await expect(detail).toBeVisible();
    await expect(page.getByText(/try clicking the RSVP link/)).toHaveCount(0);
    // `toContainText`, never `toBeVisible`: the region is sr-only.
    await expect(page.getByTestId('rsvp-page-status')).toContainText(R3_DETAIL);
    await expectInsideViewport(page, detail);

    const home = page.getByRole('link', { name: 'Go to Home' });
    const homeBox = await home.boundingBox();
    expect(homeBox, 'the Go to Home link has no layout box').not.toBeNull();
    expect(homeBox!.height, 'the Go to Home link is shorter than 44px').toBeGreaterThanOrEqual(44);

    await expectNoHorizontalScroll(page);
  });

  test('A2. RSVP: a page answering 200 that is not JSON (the parse-failure route) shows R9 (88.6.1-36)', async ({
    page,
  }) => {
    // A status under 500 passes plan 88.6.1-23's status guard, so the parse fails and the call
    // rejects `internal` — what a proxy or wifi sign-in page answering 200 does.
    await routeRespond(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: CORS_HEADERS,
        body: '<html><body>Sign in to this network</body></html>',
      }),
    );

    await page.goto(RSVP_PATH);

    await expectR9(page);
  });

  test("A3. RSVP: the backend's own server error shows R9, never the retap advice (88.6.1-36)", async ({
    page,
  }) => {
    // The path under test is plan 88.6.1-23's status guard in `respondViaToken`: a status of 500
    // or above rejects `internal` before the body is read. The body is the backend catch's own,
    // byte-for-byte (`Sonnet/routes/rsvp.js`, anchor `Something went wrong processing your RSVP.`);
    // before plan 23 this valid JSON resolved onto the retap copy.
    await routeRespond(page, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Something went wrong processing your RSVP.' }),
      }),
    );

    await page.goto(RSVP_PATH);

    await expectR9(page);
    // Backend prose is never the display string.
    await expect(page.getByText('Something went wrong processing your RSVP.')).toHaveCount(0);
  });
});
