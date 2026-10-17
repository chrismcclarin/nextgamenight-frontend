import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { settleAnimations } from './support/inFlight';

// Plan 88.6.1-74 — contract C8 (d) of plan 88.6.1-70 for the event / game page at 375px: a failed
// REFRESH over content already on screen keeps the content and shows the shared RF1 notice
// directly above the card it qualifies (owner ruling 2026-10-05, merits over record).
//
// WHAT THIS MEASURES, per view: Retry is inside the viewport and at least 44 x 44; the page never
// scrolls sideways; the notice sits directly above its card (gap at most 24px); and REACH — the
// view's primary action, when fully inside the first screen in the healthy layout, stays fully
// inside it with the notice's footprint F added. F is the distance from the RF1 line's top to the
// card's top (its margin included), measured in the failed layout itself, because releasing the
// identity read can also change what renders above the card (the timezone nudge).
//
// A FAILED LAYOUT ASSERTION IS A STOP FOR THE OWNER'S MOCKUP, never an ad-hoc restyle (plan 70's
// contract C8 (d); the revision-lap-3 manifest's reach check).
//
// HOW THE REFRESH IS MADE: the page's fetch effect depends on the resolved self identity, so
// HOLDING the identity read (every GET under /api/users/) and then releasing it forces exactly
// one same-key refresh — the most common real refresh on this page. The primary read of that
// refresh is answered 500 once. Plan 43's holdWrites holds WRITES and answers GETs, the opposite
// of what is needed here, so the read hold is local.
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

/** Holds every GET whose pathname starts with /api/users/ until `release()`. */
async function holdIdentityReads(page: Page) {
  const held: Route[] = [];
  let released = false;
  await page.route('**/api/users/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !new URL(request.url()).pathname.startsWith('/api/users/')) {
      await route.fallback();
      return;
    }
    if (released) {
      await route.fallback();
      return;
    }
    held.push(route);
  });
  return {
    heldCount: () => held.length,
    release: async () => {
      released = true;
      for (const route of held.splice(0)) await route.fallback();
    },
  };
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

async function expectRf1Layout(
  page: Page,
  card: Locator,
  primary: { bottom: number } | null,
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
  const reference = { bottom: rsvpBox!.y + rsvpBox!.height };
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Part B — the refresh failure.
  const identity = await holdIdentityReads(page);
  let failNext = false;
  let issued = 0;
  let answered = 0;
  await page.route('**/api/events/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && EVENT_GET_PATH.test(new URL(request.url()).pathname)) {
      issued += 1;
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
  await expect.poll(() => identity.heldCount(), { message: 'the identity read is held' }).toBeGreaterThan(0);
  await expect.poll(() => issued > 0 && answered === issued, { message: 'every event GET answered' }).toBe(true);
  // The card: the <h1>'s header row, then that row's parent (the card holding title, date, RSVP).
  const card = heading.locator('xpath=../..');

  failNext = true;
  await identity.release();
  const { retry, line } = rf1Line(page);
  await expect(line).toContainText(RF1, { timeout: 15_000 });

  await expect(page.getByText("We couldn't load this event")).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expectRf1Layout(page, card, reference, testInfo, 'event');

  // Retry succeeds (the route passes through again): the notice leaves and focus is on the title.
  await retry.click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveText('Game Night');
});
