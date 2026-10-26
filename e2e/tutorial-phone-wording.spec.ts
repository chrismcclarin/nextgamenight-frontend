import { test, expect, type Locator, type Page } from '@playwright/test';
import { scrubbedFetch } from './support/scrubbedFetch';

// Phase 88.6.1 plan 51 (D-16, copy rows T2-T4, R4): the tutorial's gesture wording in a real
// browser. On the phone project (375 x 667) the four press-and-hold sentences render, each fits
// its own box and can be scrolled fully into view; on journeys (1280) the click-and-drag
// sentences render and the phone sentences do not.
//
// HOW IT REACHES THE TUTORIAL. No other e2e spec reaches the tutorial, and Profile's Replay
// Tutorial is plan 88.6.1-18's in-flight surface, so this spec opens the tutorial the way a new
// user meets it: TutorialProvider auto-opens it on the home page when the self row's
// tutorial_version is below the current version. The self row GET is rewritten IN THE BROWSER to
// tutorial_version 0. The backend row is never written by this spec.
//
// WHY EVERY INTERCEPT EXISTS (all registered before the page loads; each counts what it sees, and
// none hands a request on to the backend):
// - the self row (a path ending /users/<Auth0 sub>): a GET is fetched and fulfilled with the
//   rewrite; any other method there is unexpected on the home page, so it is aborted and counted.
// - tutorial writes (a path ending /tutorial): fulfilled in the browser and counted. An
//   auto-advancing step or a stray press must never write the fixture user's tutorial state (an
//   escaped reset would re-open the tutorial over every later spec on the home page). Both tests
//   end by asserting zero writes and zero aborted self-path requests.
//
// WHY THE CLOCK IS PAUSED. Every tutorial step runs stage timers whose last one auto-advances the
// step, and the schedule hint (T4) is on screen only for that step's first 1.8 s. Playwright's
// clock is installed before the page loads and paused on the welcome step, which runs no stage
// timer, so every step is walked at stage 0 and no assertion races a timer.
//
// Expected sentences are typed here as this spec's own literals (straight apostrophe, U+2014 em
// dash) and never imported from the components, so the spec is an independent byte check.

const T2_PHONE = "Tap a time, or press and hold then drag across the times you're available — takes 30 seconds.";
const T3_PHONE = 'Press and hold, then drag across the peak to schedule.';
const T4_PHONE = 'Press and hold, then drag to set the time window — same gesture as availability.';
const R4_PHONE = 'Press and hold, then drag to schedule across the peak';

const T2_DESKTOP = "Click and drag across the times you're available — takes 30 seconds.";
const T3_DESKTOP = 'Drag across the peak to schedule.';
const T4_DESKTOP = 'Click and drag to set the time window — same gesture as availability.';
const R4_DESKTOP = 'Drag to schedule across the peak';

type Counters = { rewrites: number; tutorialWrites: number; selfAborts: number };

// An Auth0 sub carries a pipe (auth0|..., google-oauth2|...): plan 88.6.1-18's self-lookup shape.
function isSelfRowPath(url: URL): boolean {
  const m = /\/users\/([^/]+)$/.exec(url.pathname);
  if (!m) return false;
  try {
    return decodeURIComponent(m[1]).includes('|');
  } catch {
    return false;
  }
}

async function openTutorialOnHome(page: Page): Promise<Counters> {
  const counters: Counters = { rewrites: 0, tutorialWrites: 0, selfAborts: 0 };

  await page.route(isSelfRowPath, async (route) => {
    if (route.request().method() !== 'GET') {
      counters.selfAborts += 1;
      await route.abort();
      return;
    }
    const response = await scrubbedFetch(route);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      await route.fulfill({ response, json: body });
      return;
    }
    counters.rewrites += 1;
    await route.fulfill({ response, json: { ...(body as Record<string, unknown>), tutorial_version: 0 } });
  });

  await page.route(
    (url) => url.pathname.endsWith('/tutorial'),
    async (route) => {
      counters.tutorialWrites += 1;
      const method = route.request().method();
      if (method === 'PUT') {
        await route.fulfill({ status: 200, json: { tutorial_version: 3 } });
      } else if (method === 'DELETE') {
        await route.fulfill({ status: 200, json: { tutorial_version: 0 } });
      } else {
        await route.fulfill({ status: 405, json: { error: 'unexpected method in tutorial-phone-wording.spec' } });
      }
    },
  );

  // Installed before the page loads; time still runs normally until it is paused below.
  await page.clock.install();
  await page.goto('/');

  // A missing tutorial is a failure, never a skip.
  await expect(page.getByRole('button', { name: 'Show me how it works', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(counters.rewrites, 'the tutorial must open because of the self-row rewrite').toBeGreaterThanOrEqual(1);

  // Pause on the welcome step (it runs no stage timer). pauseAt needs a time no earlier than the
  // page clock's own now, which keeps running between this read and the call.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);

  return counters;
}

async function pressNextTo(page: Page, indicators: string[], press: (l: Locator) => Promise<void>) {
  // Scoped to the tutorial's footer row (the parent of its "Skip tutorial" button), because at
  // desktop width CalendarMonthView's month "Next →" is also on the page and an unscoped locator is
  // a strict-mode violation (CI run 38878098281, journeys). The tutorial surface carries no dialog
  // role to scope by (the D-49 accept), so its own footer row is the anchor. Both arms use this.
  const footer = page.getByRole('button', { name: 'Skip tutorial', exact: true }).locator('xpath=..');
  const next = footer.getByRole('button', { name: 'Next →', exact: true });
  for (const indicator of indicators) {
    await press(next);
    await expect(page.getByText(indicator, { exact: true })).toBeVisible();
  }
}

type Row = { sentence: string; x: number; y: number; width: number; height: number; vw: number; vh: number };

// Visible, reachable (scrolled into view at ratio 0.99: a line stranded above the scroll origin
// cannot be scrolled to, so this reds), and fits its own box horizontally.
async function expectFitsAndReachable(
  page: Page,
  sentence: string,
  rows: Row[],
  measureContainer = false,
): Promise<void> {
  const el = page.getByText(sentence, { exact: true });
  await expect(el).toBeVisible();
  await el.scrollIntoViewIfNeeded();
  await expect(el).toBeInViewport({ ratio: 0.99 });
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const box = await el.boundingBox();
  expect(box).not.toBeNull();
  if (!box || !viewport) return;
  rows.push({ sentence: sentence.slice(0, 24), ...box, vw: viewport.width, vh: viewport.height });
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // An inline span has no client box (CSSOM gives it clientWidth 0, so the check would read
  // 0 <= 0 and never red). For the R4 badge the wrap check runs on its block container instead,
  // reached as the sentence element's own parent.
  const overflow = await el.evaluate((node, useParent) => {
    const target = useParent ? (node.parentElement as HTMLElement) : (node as HTMLElement);
    return { scrollWidth: target.scrollWidth, clientWidth: target.clientWidth };
  }, measureContainer);
  expect(overflow.clientWidth).toBeGreaterThan(0);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

// The per-project skip is a describe-level callback (the availability-grid-touch.spec.ts idiom);
// a listing still shows both titles in both projects.
test.describe('tutorial gesture wording, phone arm (88.6.1-51, D-16)', () => {
  test.skip(({ isMobile }) => !isMobile, 'D-16 phone arm — phone project only');

  test('tutorial wording at 375: the press-and-hold sentences render, fit and can be reached', async ({ page }) => {
    const counters = await openTutorialOnHome(page);
    const rows: Row[] = [];
    const tap = (l: Locator) => l.tap();

    await pressNextTo(page, ['Step 1 of 6', 'Step 2 of 6', 'Step 3 of 6'], tap);
    await expectFitsAndReachable(page, T2_PHONE, rows);
    await expect(page.getByText(T2_DESKTOP, { exact: true })).toHaveCount(0);

    await pressNextTo(page, ['Step 4 of 6', 'Step 5 of 6'], tap);
    await expectFitsAndReachable(page, T4_PHONE, rows);
    await expectFitsAndReachable(page, T3_PHONE, rows);
    await expectFitsAndReachable(page, R4_PHONE, rows, true);
    await expect(page.getByText(T3_DESKTOP, { exact: true })).toHaveCount(0);
    await expect(page.getByText(T4_DESKTOP, { exact: true })).toHaveCount(0);
    await expect(page.getByText(R4_DESKTOP, { exact: true })).toHaveCount(0);

    // House logger rule applies to src/ only; this one line makes a red diagnosable from the CI log.
    console.log('[tutorial-wording-375]', JSON.stringify(rows));

    expect(counters.tutorialWrites, 'no tutorial write may leave the browser').toBe(0);
    expect(counters.selfAborts, 'no non-GET self-row request is expected on the home page').toBe(0);
  });
});

test.describe('tutorial gesture wording, desktop arm (88.6.1-51, D-16)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'D-16 desktop arm — journeys project only');

  test('tutorial wording at desktop width keeps the click-and-drag sentences', async ({ page }) => {
    const counters = await openTutorialOnHome(page);
    const click = (l: Locator) => l.click();

    await pressNextTo(page, ['Step 1 of 6', 'Step 2 of 6', 'Step 3 of 6'], click);
    await expect(page.getByText(T2_DESKTOP, { exact: true })).toBeVisible();
    await expect(page.getByText(T2_PHONE, { exact: true })).toHaveCount(0);

    await pressNextTo(page, ['Step 4 of 6', 'Step 5 of 6'], click);
    await expect(page.getByText(T4_DESKTOP, { exact: true })).toBeVisible();
    await expect(page.getByText(T3_DESKTOP, { exact: true })).toBeVisible();
    await expect(page.getByText(R4_DESKTOP, { exact: true })).toBeVisible();
    await expect(page.getByText(T2_PHONE, { exact: true })).toHaveCount(0);
    await expect(page.getByText(T3_PHONE, { exact: true })).toHaveCount(0);
    await expect(page.getByText(T4_PHONE, { exact: true })).toHaveCount(0);
    await expect(page.getByText(R4_PHONE, { exact: true })).toHaveCount(0);

    expect(counters.tutorialWrites, 'no tutorial write may leave the browser').toBe(0);
    expect(counters.selfAborts, 'no non-GET self-row request is expected on the home page').toBe(0);
  });
});
