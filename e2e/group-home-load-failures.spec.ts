// Phase 88.6.1-71 (Req 9, owner rulings 2026-10-05; 88.6.1-70 contract C8 (d)) — group home load
// failures at 375px in a real browser (the `phone` project, iPhone SE 375 x 667).
//
// What this proves that jsdom cannot: a real 375px layout and the real house banner. A failed
// FIRST members load shows "Couldn't load this group" with a reachable "Try again" instead of an
// endless "Loading group…", and a failed FIRST events load shows the "Calendar" heading and
// "Couldn't load this group's events" in the calendar's place instead of an empty calendar; both
// fit the phone without sideways scroll, and "Try again" recovers.
// The red halves are MB-1 and EV-1 in src/app/groupHomePage/groupHomePage.identity.test.tsx (jsdom).
//
// It runs in CI only: the phone project needs the `.auth` storage state, which does not exist
// locally (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
//
// Shared-fixture rules: the seeded group is shared with other specs. Every write is held in the
// browser by holdWrites (registered before navigation). Tests 1-2 fail GETs only, in the browser,
// with a synthetic 500; no response body is logged, printed or attached.
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { holdWrites } from './support/inFlight';
import { E2E_GROUP_ID } from './support/groupSettings';

// Copy rows G7 / G8 (D-47), the page's two load-failure titles.
const GROUP_TITLE = "Couldn't load this group";
const EVENTS_TITLE = "Couldn't load this group's events";

// The browser calls the same-origin BFF (src/lib/api.ts): the members list is
// `GET /api/groups/<id>/users`, the group's events `GET /api/events/group/<id>?…`.
const isMembersRead = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`);
const isEventsRead = (url: URL) => url.pathname.includes(`/events/group/${E2E_GROUP_ID}`);

type Mode = 'fail' | 'pass';

/** A GET-only route: in `fail` every GET gets a synthetic 500 (a message no removal phrase
 *  matches), in `pass` it continues to the backend. Any other method falls back into the hold. */
async function failGets(page: Page, matches: (url: URL) => boolean, mode: () => Mode, what: string) {
  await page.route(matches, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (mode() === 'fail') {
      await route.fulfill({ status: 500, json: { code: 'internal', message: `Simulated ${what} failure` } });
      return;
    }
    await route.continue();
  });
}

async function expectNoSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'the group page scrolls sideways at 375px',
  ).toBe(true);
}

async function expectReachable(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  const box = await locator.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box, 'the control has a layout box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
}

test.describe('group home load failures — phone', () => {
  // Both projects glob every spec, so the guard is explicit.
  test.skip(
    ({ isMobile }) => !isMobile,
    'phone-project block — the fix is viewport-independent; jsdom MB / EV / RF cover the logic',
  );

  test.beforeEach(async ({ page }) => {
    await holdWrites(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('members first-load failure shows the group banner', async ({ page }) => {
    let mode: Mode = 'fail';
    await failGets(page, isMembersRead, () => mode, 'members');

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    // D-11 dark-theme pre-assertion (the feedback-stacking.spec.ts idiom).
    await expect(page.locator('html')).toHaveClass(/dark/);

    await expect(page.getByText(GROUP_TITLE, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Loading group…', { exact: true })).toHaveCount(0);
    const tryAgain = page.getByRole('button', { name: 'Try again', exact: true });
    await expectReachable(page, tryAgain);
    await expectNoSidewaysScroll(page);

    mode = 'pass';
    await tryAgain.click();
    await expect(page.getByRole('link', { name: 'Plan Game Session' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(GROUP_TITLE, { exact: true })).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('events first-load failure shows the calendar banner, never an empty calendar', async ({ page }) => {
    let mode: Mode = 'fail';
    await failGets(page, isEventsRead, () => mode, 'events');

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await expect(page.locator('html')).toHaveClass(/dark/);

    await expect(page.getByRole('link', { name: 'Plan Game Session' })).toBeVisible({ timeout: 15_000 });
    const title = page.getByText(EVENTS_TITLE, { exact: true }).first();
    await expect(title).toBeVisible({ timeout: 15_000 });
    const heading = page.getByRole('heading', { level: 2, name: 'Calendar', exact: true });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    const titleBox = await title.boundingBox();
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(titleBox!.y);
    const viewToggle = page.getByRole('button', { name: /^(List|Month) View$/ });
    await expect(viewToggle).toHaveCount(0);
    const tryAgain = page.getByRole('button', { name: 'Try again', exact: true });
    await expectReachable(page, tryAgain);
    await expectNoSidewaysScroll(page);

    mode = 'pass';
    await tryAgain.click();
    await expect(page.getByText(EVENTS_TITLE, { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(viewToggle.first()).toBeVisible();
    // The focus target through plan 88.6.1-73's headingRef: the calendar's own title heading.
    await expect(page.getByRole('heading', { level: 2, name: 'Calendar', exact: true })).toBeFocused();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
