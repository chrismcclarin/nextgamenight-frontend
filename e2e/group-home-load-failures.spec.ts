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
// Tests 3-4 (task 2, AC-29 / RF1, D-51): a failed REFRESH keeps what was on screen and shows plan
// 88.6.1-70's notice ("Couldn't refresh. Showing what loaded earlier." + Retry) beside what it
// qualifies — members between the header and the tab strip, events above the calendar — with a
// Retry that is reachable, at least 44 x 44 and recovers. Their red halves are RF-1 and RF-2 in
// jsdom. A failed overlap, reachability, size or sideways-scroll assertion is a STOP for the
// owner's mockup (88.6.1-70 contract C8 (d)), never an ad-hoc restyle.
//
// Shared-fixture rules: the seeded group is shared with other specs. Every write is held in the
// browser by holdWrites (registered before navigation), and the afterEach fails the test if an
// /api write reached that hold. Tests 1-2 fail GETs only, in the browser, with a synthetic 500.
// Tests 3-4 drive a settings save and a Create Event whose writes (the settings PUT, the event
// POST) are FULFILLED in the browser and counted — they never reach the backend. No response body
// is logged, printed or attached.
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { E2E_GROUP_ID, openGroupSettings } from './support/groupSettings';
import { fillCreateEventManualEntry } from './support/createEvent';

// Copy rows G7 / G8 (D-47), the page's two load-failure titles.
const GROUP_TITLE = "Couldn't load this group";
const EVENTS_TITLE = "Couldn't load this group's events";
// Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

// The browser calls the same-origin BFF (src/lib/api.ts): the members list is
// `GET /api/groups/<id>/users`, the group's events `GET /api/events/group/<id>?…`.
const isMembersRead = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`);
const isEventsRead = (url: URL) => url.pathname.includes(`/events/group/${E2E_GROUP_ID}`);
// The writes tests 3-4 fulfil: `PUT /api/groups/<id>/settings` and `POST /api/events`.
const isSettingsWrite = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/settings`);
const isEventsCollection = (url: URL) => url.pathname.endsWith('/events');

/** Fulfil ONE method on a route in the browser and count it; GETs continue; any other method
 *  falls back into the hold (where the afterEach catches it). */
async function fulfillWrite(page: Page, matches: (url: URL) => boolean, method: string, status: number, json: unknown) {
  const counter = { count: 0 };
  await page.route(matches, async (route: Route) => {
    const m = route.request().method();
    if (m === method) {
      counter.count += 1;
      await route.fulfill({ status, json });
      return;
    }
    await route.fallback();
  });
  return counter;
}

/** The visible RF1 line: the notice's span (its sr-only status region holds the sentence too). */
const rf1Line = (page: Page) => page.getByText(RF1, { exact: true }).and(page.locator('span'));

async function expectBetween(above: Locator, line: Locator, below: Locator) {
  const a = await above.boundingBox();
  const l = await line.boundingBox();
  const b = await below.boundingBox();
  expect(a && l && b, 'each neighbour has a box').toBeTruthy();
  expect(l!.y, 'STOP (owner mockup): the RF1 line overlaps the control above it').toBeGreaterThanOrEqual(a!.y + a!.height);
  expect(l!.y + l!.height, 'STOP (owner mockup): the RF1 line overlaps what it sits above').toBeLessThanOrEqual(b!.y);
}

async function expectRetryFloor(page: Page, retry: Locator) {
  await expectReachable(page, retry);
  const box = await retry.boundingBox();
  expect(box!.width, 'STOP (owner mockup): Retry is narrower than 44px').toBeGreaterThanOrEqual(44);
  expect(box!.height, 'STOP (owner mockup): Retry is shorter than 44px').toBeGreaterThanOrEqual(44);
}

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

  let hold: WriteHold | undefined;

  test.beforeEach(async ({ page }) => {
    hold = await holdWrites(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
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

  test('a members refresh failure keeps the page and shows the notice', async ({ page }) => {
    let mode: Mode = 'pass';
    await failGets(page, isMembersRead, () => mode, 'members');
    // The key GroupSettings probes on the answer (`'color_preset' in saved`).
    const puts = await fulfillWrite(page, isSettingsWrite, 'PUT', 200, { id: E2E_GROUP_ID, color_preset: null });

    await openGroupSettings(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    const memberCount = page.getByText(/\d+ members?/).first();
    await expect(memberCount).toBeVisible();

    mode = 'fail';
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('heading', { name: 'Customize Group' })).toBeHidden({ timeout: 15_000 });
    const line = rf1Line(page);
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(memberCount).toBeVisible();
    await settleAnimations(page.locator('main'));
    await expectBetween(
      page.getByRole('link', { name: 'Plan Game Session' }),
      line,
      page.getByRole('button', { name: 'Overview', exact: true }),
    );
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expectRetryFloor(page, retry);
    await expectNoSidewaysScroll(page);
    expect(puts.count).toBe(1);

    mode = 'pass';
    await retry.click();
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    await expect(memberCount).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('an events refresh failure keeps the calendar and shows the notice', async ({ page }) => {
    let mode: Mode = 'pass';
    await failGets(page, isEventsRead, () => mode, 'events');
    const posts = await fulfillWrite(page, isEventsCollection, 'POST', 201, {});

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await expect(page.locator('html')).toHaveClass(/dark/);
    const heading = page.getByRole('heading', { level: 2, name: 'Calendar', exact: true });
    const viewToggle = page.getByRole('button', { name: /^(List|Month) View$/ }).first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(viewToggle).toBeVisible();

    await fillCreateEventManualEntry(page);
    mode = 'fail';
    await page.getByTestId('create-event-submit').click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeHidden({ timeout: 15_000 });
    const line = rf1Line(page);
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(heading).toBeVisible();
    await expect(viewToggle).toBeVisible();
    await settleAnimations(page.locator('main'));
    await expectBetween(page.getByRole('button', { name: 'Overview', exact: true }), line, heading);
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expectRetryFloor(page, retry);
    await expectNoSidewaysScroll(page);
    expect(posts.count).toBe(1);

    mode = 'pass';
    await retry.click();
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
