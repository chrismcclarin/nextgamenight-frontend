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

// R4 L5 (88.9-52 round 4): the rendered proof for S4. The demo week grid was 446px in a 293px scene
// at 375, so the Friday column every demo paints was cut at the card's edge and Sat and Sun were
// out of sight; and in dark a painted cell kept its light mint edge. Both were fixed without a
// browser, src/app/components/tutorial/simulated/TutorialGrid.js ("AMENDED Phase 88.9-52 (R4 S4, the round-3 capture, checked first)")
// and src/app/components/tutorial/simulated/AvailabilityPromptDemo.js ("AMENDED Phase 88.9-52 (R4 S4, the round-3 capture): in dark the cell's EDGE follows too"),
// so this is where they are measured. Called on Step 3 of 6 (the availability step) at stage 0.
//
// THE ONE CLOCK MOVE IN THIS SPEC. A painted cell exists only from stage 1, and the header above
// explains why the clock is paused at stage 0. This helper runs the paused clock forward 1000 ms,
// once, as its LAST act: that fires the step's 400 ms and 800 ms stage timers (two Friday cells
// painted) and stops well short of the 4000 ms timer that auto-advances the step. The clock stays
// paused afterwards, and the caller's next press of Next resets the stage, so nothing later in
// the test sees a moved stage. A cell's colours ease over 300 ms of real time, which the page
// clock does not own, so the fill is polled until it has changed before the edge is read.
async function expectDemoGridWholeAt375(page: Page): Promise<void> {
  // Scoped through the demo's own chip: the page behind the tutorial may show day names too.
  const demo = page
    .getByText('Adding: Preferred', { exact: true })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " text-center ")][1]');
  const sun = demo.getByText('Sun', { exact: true });
  await expect(sun).toBeVisible();
  const card = sun.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " overflow-x-auto ")][1]',
  );
  await expect(card).toHaveCount(1);
  // Vertical only: the scene scrolls up and down. A sideways scroll of the card would hide the
  // very overflow this measures, so the card's scrollLeft is asserted to be 0 below.
  await card.scrollIntoViewIfNeeded();

  const geometry = await card.evaluate((el) => {
    const parent = el.parentElement as HTMLElement;
    const rows = Array.from((el.firstElementChild as HTMLElement).children) as HTMLElement[];
    const names = (Array.from(rows[0].children) as HTMLElement[]).slice(1);
    const firstRowCells = (Array.from(rows[1].children) as HTMLElement[]).slice(1);
    const r = (n: Element) => n.getBoundingClientRect();
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
      cardLeft: r(el).left,
      cardRight: r(el).right,
      parentLeft: r(parent).left,
      parentRight: r(parent).right,
      rowCount: rows.length,
      names: names.map((n) => ({ text: (n.textContent ?? '').trim(), left: r(n).left, right: r(n).right })),
      cells: firstRowCells.map((n) => ({ left: r(n).left, right: r(n).right, width: r(n).width })),
    };
  });
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  // Guards: this is the 7-day, 8-slot grid, and it has a size.
  expect(geometry.names.map((n) => n.text)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  expect(geometry.rowCount).toBe(9);
  expect(geometry.cells).toHaveLength(7);
  expect(geometry.clientWidth).toBeGreaterThan(0);

  expect(
    geometry.scrollWidth,
    `S4: the demo grid card is ${geometry.scrollWidth - geometry.clientWidth}px wider inside than its own box at ${viewport.width}px, so part of the week is cut`,
  ).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.scrollLeft, 'S4: the demo grid card is scrolled sideways').toBe(0);
  expect(
    geometry.cardRight,
    `S4: the demo grid card's right edge (${geometry.cardRight}px) is past its parent's (${geometry.parentRight}px)`,
  ).toBeLessThanOrEqual(geometry.parentRight + 0.5);
  expect(geometry.cardLeft).toBeGreaterThanOrEqual(geometry.parentLeft - 0.5);
  expect(geometry.cardRight).toBeLessThanOrEqual(viewport.width);
  // Every day name and every column, Sun included, ends inside the card.
  for (const [i, name] of geometry.names.entries()) {
    expect(name.right, `S4: the day name ${name.text} ends outside the grid card`).toBeLessThanOrEqual(geometry.cardRight);
    expect(name.left, `S4: the day name ${name.text} starts outside the grid card`).toBeGreaterThanOrEqual(geometry.cardLeft);
    const cell = geometry.cells[i];
    expect(cell.right, `S4: the ${name.text} column ends outside the grid card`).toBeLessThanOrEqual(geometry.cardRight);
    // S4 also gave a day name its cells' side margin: the name sits over its own column.
    expect(Math.abs(name.left - cell.left), `S4: the day name ${name.text} is not over its column`).toBeLessThanOrEqual(1);
    expect(Math.abs(name.right - cell.right), `S4: the day name ${name.text} is not over its column`).toBeLessThanOrEqual(1);
    // The floor the columns give way to (24px) still holds at this width.
    expect(cell.width, `S4: the ${name.text} column is under its 24px floor`).toBeGreaterThanOrEqual(24);
  }
  // Sun can be reached, and reaching it needed no sideways scroll of the card (the reads above
  // were taken before this scroll, so it cannot have hidden an overflow from them).
  await sun.scrollIntoViewIfNeeded();
  await expect(sun).toBeInViewport({ ratio: 0.99 });
  expect(await card.evaluate((el) => el.scrollLeft), 'S4: showing Sun took a sideways scroll of the grid card').toBe(0);

  // Dark: a painted cell's edge is the plain line an unpainted cell has. The phone project is
  // pinned dark; asserted here so a light run reds on the guard and not on the colours.
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.clock.runFor(1000);
  const readEdges = () =>
    card.evaluate((el) => {
      const rows = Array.from((el.firstElementChild as HTMLElement).children) as HTMLElement[];
      const row = rows[3]; // the header row, then 5:00, 5:30, 6:00 PM
      const painted = row.children[5] as HTMLElement; // the time gutter, then Mon to Fri
      const plain = row.children[4] as HTMLElement; // Thu, never painted
      return {
        time: (row.children[0].textContent ?? '').trim(),
        paintedFill: getComputedStyle(painted).backgroundColor,
        plainFill: getComputedStyle(plain).backgroundColor,
        paintedEdge: getComputedStyle(painted).borderTopColor,
        plainEdge: getComputedStyle(plain).borderTopColor,
      };
    });
  expect((await readEdges()).time, 'the row read for the painted cell is not the 6:00 PM row').toBe('6:00 PM');
  // Guard: the Friday 6:00 PM cell really is painted (its fill has left the unpainted one).
  await expect
    .poll(async () => {
      const e = await readEdges();
      return e.paintedFill !== e.plainFill;
    }, { message: 'S4: no painted cell after 1000 ms on the availability step, so the edge check below measures nothing' })
    .toBe(true);
  // Let the 300 ms ease finish, in real time, then read once.
  await page.waitForTimeout(400);
  const edges = await readEdges();
  expect(edges.paintedFill).not.toBe(edges.plainFill);
  expect(edges.paintedEdge, 'S4: in dark a painted demo cell has a different edge colour from an unpainted one').toBe(edges.plainEdge);
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
    // R4 L5 (88.9-52): the demo week grid is whole at 375 and, in dark, a painted cell keeps the plain edge.
    await expectDemoGridWholeAt375(page);

    await pressNextTo(page, ['Step 4 of 6', 'Step 5 of 6'], tap);
    await expectFitsAndReachable(page, T4_PHONE, rows);
    await expectFitsAndReachable(page, T3_PHONE, rows);
    await expectFitsAndReachable(page, R4_PHONE, rows, true);
    await expect(page.getByText(T3_DESKTOP, { exact: true })).toHaveCount(0);
    await expect(page.getByText(T4_DESKTOP, { exact: true })).toHaveCount(0);
    await expect(page.getByText(R4_DESKTOP, { exact: true })).toHaveCount(0);

    // eslint-disable-next-line no-console -- this one line makes a red diagnosable from the CI log
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
