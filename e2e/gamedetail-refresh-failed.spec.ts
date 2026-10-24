import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { holdRequests, settleAnimations } from './support/inFlight';

// Plan 88.6.1-74 — contract C8 (d) of plan 88.6.1-70 for the event / game page at 375px: a failed
// REFRESH over content already on screen keeps the content and shows the shared RF1 notice
// directly above the card it qualifies (owner ruling 2026-10-05, merits over record).
//
// WHAT THIS MEASURES, per view: Retry is inside the viewport and at least 44 x 44; the page never
// scrolls sideways; the notice sits directly above its card (gap at most 24px); and REACH — the
// view's primary action, when fully inside the first screen in the healthy layout, stays fully
// inside it with the notice's footprint F added. F is the distance from the RF1 line's top to the
// card's top (its margin included), measured in the failed layout itself, because releasing the
// identity read can also change what renders above the card (the timezone nudge). Wave 9 gate
// (2026-10-17, run 39026336968): the EVENT arm takes REACH as a DIRECT measurement in the failed
// layout instead (the RSVP group's own bottom, once the notice is on screen); see the DECISION marker
// in expectRf1Layout. The game arm keeps the projection.
//
// A FAILED LAYOUT ASSERTION IS A STOP FOR THE OWNER'S MOCKUP, never an ad-hoc restyle (plan 70's
// contract C8 (d); the revision-lap-3 manifest's reach check).
//
// HOW THE REFRESH IS MADE: the page's fetch effect depends on the resolved self identity, so
// HOLDING the identity read (every GET under /api/users/) and then releasing it forces exactly
// one same-key refresh — the most common real refresh on this page. The primary read of that
// refresh is answered 500 once. The identity read goes through the shared read-capable hold
// (holdRequests in e2e/support/inFlight.ts, Phase 88.6.2-11) and is released to the network;
// plan 43's holdWrites holds WRITES and answers GETs, the opposite of what is needed here.
//
// PHONE ONLY and CI ONLY, like every signed-in spec here: the phone project needs the setup
// project's login, whose credentials exist only in CI. Locally the proof is the e2e typecheck and
// `playwright test --list`. Nothing is screenshotted (the page shows group members' names).

// Copy row RF1 / D-47: plan 88.6.1-70's REFRESH_FAILED_NOTICE, written once in this spec.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;
const EVENT_ID = new URL(E2E_EVENT_DETAIL_PATH, 'http://localhost').searchParams.get('event_id') ?? '1';
const EVENT_GET_PATH = new RegExp(`^/api/events/${EVENT_ID}$`);

// The CI fixture event has no participations; the Participants card renders only with one, so
// the healthy layout gets ONE custom participant (a typed-in name with no account), plan 47's
// technique. The patch is applied in both parts, so the two layouts compare like for like.
const CUSTOM_PARTICIPANT = {
  user_id: null,
  username: 'E2E participant',
  is_guest: true,
  is_custom: true,
};

test.skip(({ isMobile }) => !isMobile, 'C8 (d) is a phone-tenet check — phone project only');

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function noSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function patchedEventBody(route: Route) {
  const response = await route.fetch();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { response, body: undefined };
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const event = body as { EventParticipations?: unknown };
    if (!Array.isArray(event.EventParticipations) || event.EventParticipations.length === 0) {
      event.EventParticipations = [CUSTOM_PARTICIPANT];
    }
  }
  return { response, body };
}

/** The RF1 line: the Retry button's own row, which carries the sentence (never a status region). */
function rf1Line(page: Page): { retry: Locator; line: Locator } {
  const retry = page.getByRole('main').getByRole('button', { name: 'Retry', exact: true });
  return { retry, line: retry.locator('..') };
}

/** REACH input. `bottom` = a PROJECTION: a bottom measured in the healthy layout, plus F (the game
 *  arm). `direct` = a DIRECT measurement in the failed layout itself, gated on the healthy bottom
 *  having been inside the first screen (the event arm, wave 9 gate). */
type Reach = { bottom: number } | { direct: Locator; healthyBottom: number };

async function expectRf1Layout(
  page: Page,
  card: Locator,
  primary: Reach | null,
  testInfo: { annotations: Array<{ type: string; description?: string }> },
  label: string
) {
  const viewport = page.viewportSize();
  expect(viewport, 'a viewport').not.toBeNull();
  const { retry, line } = rf1Line(page);
  await expect(line).toContainText(RF1);
  await settleAnimations(page.getByRole('main'));

  const retryBox = await retry.boundingBox();
  expect(retryBox, 'Retry has a box').not.toBeNull();
  expect(retryBox!.width, 'STOP (owner mockup): Retry is narrower than 44px').toBeGreaterThanOrEqual(44);
  expect(retryBox!.height, 'STOP (owner mockup): Retry is shorter than 44px').toBeGreaterThanOrEqual(44);
  expect(retryBox!.x, 'STOP (owner mockup): Retry starts left of the viewport').toBeGreaterThanOrEqual(0);
  expect(retryBox!.y, 'STOP (owner mockup): Retry starts above the viewport').toBeGreaterThanOrEqual(0);
  expect(retryBox!.x + retryBox!.width, 'STOP (owner mockup): Retry overflows the viewport').toBeLessThanOrEqual(viewport!.width);
  expect(retryBox!.y + retryBox!.height, 'STOP (owner mockup): Retry is below the first screen').toBeLessThanOrEqual(viewport!.height);

  expect(await noSidewaysScroll(page), 'STOP (owner mockup): the page scrolls sideways').toBe(true);

  const lineBox = await line.boundingBox();
  const cardBox = await card.boundingBox();
  expect(lineBox, 'the RF1 line has a box').not.toBeNull();
  expect(cardBox, 'the card has a box').not.toBeNull();
  const lineBottom = lineBox!.y + lineBox!.height;
  const gap = cardBox!.y - lineBottom;
  expect(gap, `STOP (owner mockup): the notice must sit above its card (gap ${gap}px)`).toBeGreaterThanOrEqual(0);
  expect(gap, `STOP (owner mockup): the notice is ${gap}px above its card (max 24)`).toBeLessThanOrEqual(24);

  const footprint = cardBox!.y - lineBox!.y;
  expect(footprint, 'the notice has a footprint').toBeGreaterThan(0);
  // DECISION Phase 88.6.1-74 (wave 9 gate, orchestrator-routed 2026-10-17, CI run 39026336968): the
  // EVENT arm measures REACH DIRECTLY — the RSVP group's own bottom in the failed layout, after the
  // notice is on screen and animations settle, against the first screen — OVER the projection
  // (healthy bottom + F) the game arm still uses. The projection failed there at 584 + 88 = 672 > 667
  // while the retry screenshot showed the group's real bottom near 549px, inside the screen: the
  // reference came from a different layout state (Part A), and the fixture's date wraps to two lines
  // at 375px, so the reference moved with the calendar date. A direct overflow is still a STOP for
  // the owner's mockup, never a restyle. Going back to the projection here is a decision, not a cleanup.
  if (primary && 'direct' in primary) {
    const reach = await primary.direct.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { bottom: box.bottom + window.scrollY, scrollY: window.scrollY, innerHeight: window.innerHeight };
    });
    testInfo.annotations.push({
      type: `${label} RF1 reach (direct)`,
      description: `F=${footprint}px, viewport=${viewport!.width}x${viewport!.height}, healthy bottom=${primary.healthyBottom}, failed-layout bottom=${reach.bottom} (scrollY ${reach.scrollY})`,
    });
    if (primary.healthyBottom <= viewport!.height) {
      expect(
        reach.bottom,
        `STOP (owner mockup): REACH — with the notice on screen the primary action's bottom is ${reach.bottom}px (measured directly; F=${footprint}px), past the ${reach.innerHeight}px first screen`
      ).toBeLessThanOrEqual(reach.innerHeight);
    }
    return;
  }
  testInfo.annotations.push({
    type: `${label} RF1 footprint`,
    description: `F=${footprint}px, viewport=${viewport!.width}x${viewport!.height}, primary bottom=${primary ? primary.bottom : 'n/a'}`,
  });
  if (primary && primary.bottom <= viewport!.height) {
    expect(
      primary.bottom + footprint,
      `STOP (owner mockup): REACH — the primary action (bottom ${primary.bottom}px) plus the notice footprint F=${footprint}px leaves the ${viewport!.height}px first screen`
    ).toBeLessThanOrEqual(viewport!.height);
  }
}

test('event page: a failed background refresh keeps the event and shows the notice above it, phone layout intact', async ({
  page,
}, testInfo) => {
  // Part A — the healthy reference layout.
  await page.route('**/api/events/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && EVENT_GET_PATH.test(new URL(request.url()).pathname)) {
      const { response, body } = await patchedEventBody(route);
      if (body === undefined) await route.fulfill({ response });
      else await route.fulfill({ response, json: body });
      return;
    }
    await route.fallback();
  });
  await page.goto(E2E_EVENT_DETAIL_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Game Night' })).toBeVisible();
  const rsvpGroup = page.getByRole('group', { name: /^RSVP for / });
  await expect(rsvpGroup).toBeVisible();
  await settleAnimations(page.getByRole('main'));
  const rsvpBox = await rsvpGroup.boundingBox();
  expect(rsvpBox, 'the RSVP group has a box').not.toBeNull();
  // Wave 9 gate: Part A now only GATES the direct reach check (was the healthy RSVP group inside the
  // first screen at all?); the measurement itself is taken in the failed layout (expectRf1Layout).
  const healthyBottom = rsvpBox!.y + rsvpBox!.height;
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Part B — the refresh failure.
  // DIAGNOSTIC ONLY (wave 7 CI gate, run 39020174955): this arm withdrew the event to the full
  // "We couldn't load this event" banner in both attempts, which the page does only on a different
  // entity key, an access answer, or a fresh mount, and the same sequence keeps the event under RF1
  // in jsdom. The trail below (request order and answers, main-frame navigations, page errors, and
  // the loader / h1 timeline after the release) is printed ONLY when the RF1 wait fails, so the
  // next CI run names the mechanism. It asserts nothing and changes nothing the page sees.
  const startedAt = Date.now();
  const trail: string[] = [];
  const mark = (entry: string) => trail.push(`${Date.now() - startedAt}ms ${entry}`);
  page.on('pageerror', (error) => mark(`pageerror ${error.name}: ${error.message.slice(0, 160)}`));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) mark(`navigated ${new URL(frame.url()).pathname}`);
  });
  const identity = await holdRequests(page, { method: 'GET', match: (url) => url.pathname.startsWith('/api/users/') });
  let failNext = false;
  let issued = 0;
  let answered = 0;
  await page.route('**/api/events/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && EVENT_GET_PATH.test(new URL(request.url()).pathname)) {
      issued += 1;
      mark(`event GET #${issued}${failNext ? ' (answered 500)' : ''}`);
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, json: { error: 'e2e refresh failure' } });
        answered += 1;
        return;
      }
      const { response, body } = await patchedEventBody(route);
      if (body === undefined) await route.fulfill({ response });
      else await route.fulfill({ response, json: body });
      answered += 1;
      return;
    }
    await route.fallback();
  });
  await page.goto(E2E_EVENT_DETAIL_PATH);
  const heading = page.getByRole('heading', { level: 1, name: 'Game Night' });
  await expect(heading).toBeVisible();
  await expect.poll(() => identity.count(), { message: 'the identity read is held' }).toBeGreaterThan(0);
  await expect.poll(() => issued > 0 && answered === issued, { message: 'every event GET answered' }).toBe(true);
  // The card: the <h1>'s header row, then that row's parent (the card holding title, date, RSVP).
  const card = heading.locator('xpath=../..');

  await page.evaluate((loaderLabel) => {
    const w = window as unknown as { __rf1Trail?: string[] };
    const trailInPage: string[] = [];
    w.__rf1Trail = trailInPage;
    const t0 = performance.now();
    const sample = () => {
      const loader = Boolean(document.querySelector(`[role="status"][aria-label="${loaderLabel}"]`));
      const h1 = Boolean(document.querySelector('main h1'));
      const state = `loader=${loader} h1=${h1}`;
      if (!trailInPage.length || !trailInPage[trailInPage.length - 1].endsWith(state)) {
        trailInPage.push(`${Math.round(performance.now() - t0)}ms ${state}`);
      }
    };
    sample();
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true });
  }, 'Loading game night...');

  failNext = true;
  mark(`releasing ${identity.count()} held identity read(s)`);
  await identity.releaseToNetwork();
  const { retry, line } = rf1Line(page);
  try {
    await expect(line).toContainText(RF1, { timeout: 15_000 });
  } catch (error) {
    const inPage = await page
      .evaluate(() => (window as unknown as { __rf1Trail?: string[] }).__rf1Trail ?? ['no trail: a new document'])
      .catch(() => ['evaluate failed']);
    console.log(`[DIAG gamedetail-refresh-event] ${JSON.stringify({ trail, inPage })}`);
    throw error;
  }

  await expect(page.getByText("We couldn't load this event")).toHaveCount(0);
  await expect(heading).toBeVisible();
  // Wave 9 gate: the notice is above the KEPT content — the RSVP group is still on the page.
  await expect(rsvpGroup).toBeVisible();
  await expectRf1Layout(page, card, { direct: rsvpGroup, healthyBottom }, testInfo, 'event');

  // Retry succeeds (the route passes through again): the notice leaves and focus is on the title.
  await retry.click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText('Game Night');
});

// No game fixture exists in CI, so the game arm serves a CUSTOM game for a fixed fake id (the
// custom branch renders the name and no image) and an empty review list; the group's events and
// roster are real, on the real E2E_GROUP_ID.
const E2E_FAKE_GAME_ID = '0e2e0000-0000-4000-8000-000000000074';
const E2E_GAME_PATH = `/gameDetail?game_id=${E2E_FAKE_GAME_ID}&group_id=${E2E_GROUP_ID}`;
const GAME_GET_PATH = new RegExp(`^/api/games/${E2E_FAKE_GAME_ID}$`);
const REVIEWS_PREFIX = `/api/game-reviews/game/${E2E_FAKE_GAME_ID}/`;
const E2E_GAME_NAME = 'E2E Custom Game';
const E2E_GAME = {
  id: E2E_FAKE_GAME_ID,
  name: E2E_GAME_NAME,
  is_custom: true,
  bgg_id: null,
  theme: null,
  image_url: null,
  min_players: 2,
  max_players: 4,
  playing_time: 45,
};

/** Routes the fake game and its reviews; `failNext()` answers the next game GET 500 once. */
async function routeFakeGame(page: Page) {
  let failNext = false;
  let issued = 0;
  let answered = 0;
  await page.route('**/api/game-reviews/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith(REVIEWS_PREFIX)) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/games/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && GAME_GET_PATH.test(new URL(request.url()).pathname)) {
      issued += 1;
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, json: { error: 'e2e refresh failure' } });
      } else {
        await route.fulfill({ json: E2E_GAME });
      }
      answered += 1;
      return;
    }
    await route.fallback();
  });
  return {
    failNext: () => {
      failNext = true;
    },
    settled: () => issued > 0 && answered === issued,
  };
}

test('game page: a failed background refresh keeps the game and shows the notice above it, phone layout intact', async ({
  page,
}, testInfo) => {
  // Part A — the healthy reference layout.
  await routeFakeGame(page);
  await page.goto(E2E_GAME_PATH);
  await expect(page.getByRole('heading', { level: 1, name: E2E_GAME_NAME })).toBeVisible();
  const cta = page.getByRole('button', { name: 'Plan a game night with this' });
  await expect(
    cta,
    'the reference CTA never showed: the fixture user must be a member of E2E_GROUP_ID (a missing reference, not a layout STOP)'
  ).toBeVisible({ timeout: 15_000 });
  await settleAnimations(page.getByRole('main'));
  const ctaBox = await cta.boundingBox();
  expect(ctaBox, 'the CTA has a box').not.toBeNull();
  const reference = { bottom: ctaBox!.y + ctaBox!.height };
  testInfo.annotations.push({
    type: 'game reference CTA',
    description: `x=${ctaBox!.x} y=${ctaBox!.y} w=${ctaBox!.width} h=${ctaBox!.height}`,
  });
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Part B — the refresh failure.
  const identity = await holdRequests(page, { method: 'GET', match: (url) => url.pathname.startsWith('/api/users/') });
  const game = await routeFakeGame(page);
  await page.goto(E2E_GAME_PATH);
  const heading = page.getByRole('heading', { level: 1, name: E2E_GAME_NAME });
  await expect(heading).toBeVisible();
  await expect.poll(() => identity.count(), { message: 'the identity read is held' }).toBeGreaterThan(0);
  await expect.poll(() => game.settled(), { message: 'every game GET answered' }).toBe(true);

  game.failNext();
  await identity.releaseToNetwork();
  const { retry, line } = rf1Line(page);
  await expect(line).toContainText(RF1, { timeout: 15_000 });
  // The Game Details card: the element directly after the notice's own wrapper (the notice
  // renders its polite region, then its line wrapper, then the card follows), checked to hold
  // the title.
  const card = line.locator('xpath=../following-sibling::div[1]');
  await expect(card.getByRole('heading', { level: 1, name: E2E_GAME_NAME })).toBeVisible();

  await expect(page.getByText("We couldn't load this game")).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expectRf1Layout(page, card, reference, testInfo, 'game');

  // Retry succeeds (the route passes through again): the notice leaves and focus is on the title.
  await retry.click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText(E2E_GAME_NAME);
});
