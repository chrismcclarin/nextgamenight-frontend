// Phase 88.6.1-56 (AC-29, D-50, D-51; contract C8 d) — a failed games refresh on the group page
// keeps what loaded, under the RF1 refresh notice, at 375px.
//
// What this proves that jsdom cannot: a real browser at phone width laying the notice row out
// BETWEEN the 'Group Games' heading and the sort toolbar (cards kept), and ABOVE the empty state
// (a list that loaded empty, owner ruling Y / D-50), with a Retry that is on screen, at least
// 44x44, and no sideways scroll. The logic halves are pinned RED-then-GREEN in jsdom
// (GroupGamesList.emptyState.test.tsx: GG-1, GG-4, GG-6); this spec runs in CI only.
//
// Shared-fixture rule: plan 88.6.1-43's write hold is registered FIRST, so every write is held
// unless this spec answers it in the browser. Create Event's manual path writes twice — the typed
// game name's resolve POST and the events POST — and both are answered here and counted; the
// games reads are synthetic. No response body is logged, printed or attached.
//
// The only in-app refetch of the games after a successful load is creating an event (the page's
// handleEventCreated refreshes the games), so the spec drives Create Event (plan 88.6.1-71's one
// drive) and fails the games GET that follows it.
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { fillCreateEventManualEntry } from './support/createEvent';
import { holdWrites } from './support/inFlight';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// copy row RF1 / D-47 — the shared refresh notice's sentence (plan 88.6.1-70 owns the one constant;
// written once here, contract C7).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
const GAMES_TITLE = "We couldn't load this group's games";
const EMPTY_HEADING = 'No game nights logged yet';
const RETAINED_GAME = 'E2E Retained Game';

const RESOLVED_GAME = { id: '00000000-0000-4000-8000-0000000088e6', name: 'E2E resolved game' };
const GAME_FIXTURE = [
  {
    id: '00000000-0000-4000-8000-0000000088e7',
    name: RETAINED_GAME,
    image_url: null,
    play_count: 1,
    last_played: '2026-10-01T19:00:00.000Z',
    avg_rating: null,
    review_count: 0,
    theme: null,
    min_players: null,
    max_players: null,
  },
];

// The browser calls the same-origin BFF (src/lib/api.ts): the games list is
// `GET /api/lists/games/<group>/<user>?…` (plan 88.6.1-55's predicate).
const isGroupGamesRead = (url: URL) => url.pathname.includes(`/lists/games/${E2E_GROUP_ID}/`);
const isGameResolve = (url: URL) => url.pathname.endsWith('/games/resolve');
const isEventsCollection = (url: URL) => url.pathname.endsWith('/events');

type GamesMode = 'list' | 'fail';

/** ONE route for this spec's three answers; anything else falls back (into the write hold for a
 *  write, to the network for a read). */
async function routeGroupPage(page: Page, games: unknown[], mode: () => GamesMode) {
  const counts = { resolve: 0, events: 0, gamesFailed: 0 };
  await page.route(
    (url) => isGameResolve(url) || isEventsCollection(url) || isGroupGamesRead(url),
    async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST' && isGameResolve(url)) {
        counts.resolve += 1;
        await route.fulfill({ status: 200, json: RESOLVED_GAME });
        return;
      }
      if (request.method() === 'POST' && isEventsCollection(url)) {
        counts.events += 1;
        await route.fulfill({ status: 201, json: {} });
        return;
      }
      if (request.method() === 'GET' && isGroupGamesRead(url)) {
        if (mode() === 'fail') {
          counts.gamesFailed += 1;
          await route.fulfill({ status: 500, json: { code: 'internal', message: 'Simulated games failure' } });
          return;
        }
        await route.fulfill({ status: 200, json: games });
        return;
      }
      await route.fallback();
    },
  );
  return counts;
}

async function expectRetryOnPhone(page: Page, retry: Locator) {
  await retry.scrollIntoViewIfNeeded();
  await expect(retry).toBeInViewport();
  const box = await retry.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box!.width, 'STOP (owner mockup): Retry is narrower than 44px').toBeGreaterThanOrEqual(44);
  expect(box!.height, 'STOP (owner mockup): Retry is shorter than 44px').toBeGreaterThanOrEqual(44);
  expect(box!.x, 'STOP (owner mockup): Retry starts off screen').toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'STOP (owner mockup): Retry ends off screen').toBeLessThanOrEqual(width);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'STOP (owner mockup): the group page scrolls sideways at 375px',
  ).toBe(true);
}

/** Load the page on the fixture, then create an event with the games refresh set to fail. */
async function failTheGamesRefresh(page: Page, firstLoadSignal: Locator, setMode: (m: GamesMode) => void) {
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await expect(firstLoadSignal).toBeVisible({ timeout: 15_000 });
  await fillCreateEventManualEntry(page);
  setMode('fail');
  await page.getByTestId('create-event-submit').click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeHidden({ timeout: 15_000 });
}

test.describe('group games failed refresh — phone', () => {
  // Plan 88.6.1-55's guard shape: the layout claim is the phone's.
  test.skip(
    ({ isMobile }) => !isMobile,
    'phone-project block — the layout is the claim; jsdom GG-1..GG-11 cover the logic',
  );

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a failed games refresh keeps the cards under the notice, and Retry returns focus to the section', async ({
    page,
  }) => {
    const hold = await holdWrites(page);
    let mode: GamesMode = 'list';
    const counts = await routeGroupPage(page, GAME_FIXTURE, () => mode);
    const card = page.getByRole('heading', { name: RETAINED_GAME, exact: true });
    await failTheGamesRefresh(page, card, (m) => {
      mode = m;
    });

    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    const row = retry.locator('xpath=..');
    await expect(row).toContainText(RF1);
    await expect(card).toBeVisible();
    await expect(page.getByText(GAMES_TITLE, { exact: true })).toHaveCount(0);

    const heading = page.getByRole('heading', { level: 2, name: 'Group Games', exact: true });
    const rowBox = await row.boundingBox();
    const headingBox = await heading.boundingBox();
    const sortBox = await page.getByText('Sort by:', { exact: true }).boundingBox();
    expect(rowBox!.y, 'STOP (owner mockup): the notice is not below the Group Games heading').toBeGreaterThanOrEqual(
      headingBox!.y + headingBox!.height,
    );
    expect(rowBox!.y + rowBox!.height, 'STOP (owner mockup): the notice is not above Sort by').toBeLessThanOrEqual(
      sortBox!.y,
    );
    await expectRetryOnPhone(page, retry);

    mode = 'list';
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(retry).toHaveCount(0, { timeout: 15_000 });
    await expect(heading).toBeFocused();

    expect(counts.events).toBe(1);
    expect(counts.resolve).toBeLessThanOrEqual(1);
    expect(counts.gamesFailed).toBeGreaterThan(0);
    expect(hold.count('POST', /\/events$/)).toBe(0);
    expect(hold.count('POST', /\/games\/resolve$/)).toBe(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a failed games refresh over a list that loaded empty keeps the empty state under the notice (D-50)', async ({
    page,
  }) => {
    const hold = await holdWrites(page);
    let mode: GamesMode = 'list';
    const counts = await routeGroupPage(page, [], () => mode);
    const empty = page.getByRole('heading', { name: EMPTY_HEADING, exact: true });
    await failTheGamesRefresh(page, empty, (m) => {
      mode = m;
    });

    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    const row = retry.locator('xpath=..');
    await expect(row).toContainText(RF1);
    await expect(empty).toBeVisible();
    await expect(page.getByText(GAMES_TITLE, { exact: true })).toHaveCount(0);

    const rowBox = await row.boundingBox();
    const emptyBox = await empty.boundingBox();
    expect(rowBox!.y + rowBox!.height, 'STOP (owner mockup): the notice is not above the empty state').toBeLessThanOrEqual(
      emptyBox!.y,
    );
    await expectRetryOnPhone(page, retry);

    expect(counts.events).toBe(1);
    expect(counts.resolve).toBeLessThanOrEqual(1);
    expect(counts.gamesFailed).toBeGreaterThan(0);
    expect(hold.count('POST', /\/events$/)).toBe(0);
    expect(hold.count('POST', /\/games\/resolve$/)).toBe(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
