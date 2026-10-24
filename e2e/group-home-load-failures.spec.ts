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
// Tests 5-6 (88.6.1-89, close rulings P-79 / P-80): a failed FIRST load of the group record itself
// (not a removal) shows "Couldn't load this group" with a reachable "Try again" that recovers,
// never a page headed by the fallback name; and while the group's first events request is out the
// calendar's place says "Loading calendar..." under its Calendar heading, never an empty month.
// Their red halves are GL-1 and CL-1 in jsdom. Test 5 fails GETs only; test 6 holds the events
// GETs in the browser and then continues them to the backend.
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
import { expectTouchTarget } from './support/touchTarget';

// Copy rows G7 / G8 (D-47), the page's two load-failure titles.
const GROUP_TITLE = "Couldn't load this group";
const EVENTS_TITLE = "Couldn't load this group's events";
// Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
// Copy row P80 (close ruling P-80): the calendar's own loading line, written once here.
const CALENDAR_LOADING = 'Loading calendar...';

// The browser calls the same-origin BFF (src/lib/api.ts): the members list is
// `GET /api/groups/<id>/users`, the group's events `GET /api/events/group/<id>?…`.
const isMembersRead = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`);
const isEventsRead = (url: URL) => url.pathname.includes(`/events/group/${E2E_GROUP_ID}`);
// 88.6.1-89: the group record itself, `GET /api/groups/<id>` (`groupsAPI.getGroup`).
const isGroupRead = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}`);
// The writes tests 3-4 fulfil: `PUT /api/groups/<id>/settings` and `POST /api/events`.
const isSettingsWrite = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/settings`);
const isEventsCollection = (url: URL) => url.pathname.endsWith('/events');
// Wave 9 gate: Create Event resolves a TYPED game name before it posts the event
// (`createEvent.js` submit, `gamesAPI.resolveGame` -> `POST /api/games/resolve`).
const isGameResolve = (url: URL) => url.pathname.endsWith('/games/resolve');
// A synthetic game id: it only ever reaches the fulfilled POST /api/events below.
const RESOLVED_GAME = { id: '00000000-0000-4000-8000-0000000088e2', name: 'E2E resolved game' };

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
  await expectTouchTarget(retry, 'STOP (owner mockup): Retry');
}

type Mode = 'fail' | 'pass';

/** A GET-only route: in `fail` every GET gets a synthetic 500 (a message no removal phrase
 *  matches), in `pass` it continues to the backend. Any other method falls back into the hold. */
async function failGets(page: Page, matches: (url: URL) => boolean, mode: () => Mode, what: string) {
  // Wave 9 gate: counts the GETs answered 500, so a test can wait on the failed refresh itself.
  const failed = { count: 0 };
  await page.route(matches, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (mode() === 'fail') {
      await route.fulfill({ status: 500, json: { code: 'internal', message: `Simulated ${what} failure` } });
      failed.count += 1;
      return;
    }
    await route.continue();
  });
  return failed;
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
    const eventsFailed = await failGets(page, isEventsRead, () => mode, 'events');
    const posts = await fulfillWrite(page, isEventsCollection, 'POST', 201, {});
    // DECISION Phase 88.6.1-71 (wave 9 gate, orchestrator-routed 2026-10-17, CI run 39026336968):
    // the typed game name's resolve write is FULFILLED here, OVER leaving it to the write hold. The
    // first attempt held `POST /api/games/resolve` (the afterEach backstop named it), so the submit
    // never reached POST /api/events and the dialog stayed open (`toBeHidden` timed out). Its count
    // is not asserted: this arm is about the events refresh, not about how the game is picked.
    await fulfillWrite(page, isGameResolve, 'POST', 200, RESOLVED_GAME);

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await expect(page.locator('html')).toHaveClass(/dark/);
    const heading = page.getByRole('heading', { level: 2, name: 'Calendar', exact: true });
    const viewToggle = page.getByRole('button', { name: /^(List|Month) View$/ }).first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(viewToggle).toBeVisible();

    await fillCreateEventManualEntry(page);
    mode = 'fail';
    await page.getByTestId('create-event-submit').click();
    // Wave 9 gate: positive signals before the hidden / visible reads — the event write was
    // answered, then the refresh it triggers was answered 500.
    await expect.poll(() => posts.count, { message: 'POST /api/events answered', timeout: 15_000 }).toBe(1);
    await expect(page.getByRole('heading', { name: /create event/i })).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(() => eventsFailed.count, { message: 'the events refresh was answered 500', timeout: 15_000 })
      .toBeGreaterThan(0);
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

  test('group record first-load failure shows the group banner (88.6.1-89, P-79)', async ({ page }) => {
    let mode: Mode = 'fail';
    await failGets(page, isGroupRead, () => mode, 'group');

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await expect(page.locator('html')).toHaveClass(/dark/);

    await expect(page.getByText(GROUP_TITLE, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Plan Game Session' })).toHaveCount(0);
    const tryAgain = page.getByRole('button', { name: 'Try again', exact: true });
    await expectReachable(page, tryAgain);
    await expectNoSidewaysScroll(page);

    mode = 'pass';
    await tryAgain.click();
    await expect(page.getByRole('link', { name: 'Plan Game Session' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(GROUP_TITLE, { exact: true })).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('the calendar names its first load (88.6.1-89, P-80)', async ({ page }) => {
    // Every events GET that arrives before the release waits for it, then continues to the
    // backend; a GET after the release continues at once. Any other method falls back into the
    // hold (the afterEach catches it).
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = { count: 0 };
    await page.route(isEventsRead, async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      held.count += 1;
      await released;
      await route.continue();
    });

    try {
      await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
      await expect(page.locator('html')).toHaveClass(/dark/);

      await expect(page.getByRole('link', { name: 'Plan Game Session' })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => held.count, { message: 'the first events GET is held', timeout: 15_000 }).toBeGreaterThan(0);
      const loading = page.getByText(CALENDAR_LOADING, { exact: true });
      await expect(loading).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Calendar', exact: true })).toBeVisible();
      await expectReachable(page, loading);
      await expectNoSidewaysScroll(page);

      release();
      await expect(page.getByRole('button', { name: /^(List|Month) View$/ }).first()).toBeVisible({ timeout: 15_000 });
      await expect(loading).toHaveCount(0);
    } finally {
      release();
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
