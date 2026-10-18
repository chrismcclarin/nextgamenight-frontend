import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { expectNoApiWrites, holdWrites, settleAnimations } from './support/inFlight';

// Phase 88.6.1 plan 11 (Req 4 / D-35, Req 5, the SPEC's 44x44 floor): the Plan Game Session
// page's Remind button, seen in a real browser.
//
// WHAT THIS CHECKS THAT JSDOM CANNOT. The jsdom suite (`src/app/components/ResponseDashboard.test.tsx`,
// the D-35 / Req 5 describe) proves the attributes, the per-row latch and the focus hook with
// classes only, and jsdom has no layout and never blurs a disabled control (C-11). This spec
// measures the 44px floor and the row height at 375px, proves the pressed button KEEPS focus
// while the reminder is in flight and that focus lands on the row's "Reminded ..." text after the
// success, and pins the owner's 2026-10-05 condition on the floor: no Remind tap area overlaps any
// other control in the dashboard card, its own row and the rows above and below included.
//
// NOT RUN LOCALLY. Both projects depend on the `setup` project, which drives Auth0 Universal Login
// with credentials that are deliberately absent locally (C-14 in
// .planning/codebase/FE-TESTING-CONVENTIONS.md). Typecheck and listing are the only local proof;
// the CI e2e job is the proof. Both projects run every test: the floor, the focus contract and
// the no-overlap property hold at every width.
//
// SYNTHETIC DATA, NOTHING SENT. Three browser requests are answered by `page.route`, each a
// pathname predicate with a method check (anything else continues to the backend):
//   - the active-prompt GET, so the page mounts the dashboard on a prompt this spec controls;
//   - the respondents GET, so there are exactly three pending rows (A, B, C) with fixed UUIDs that
//     no seeded user owns, so every row shows Remind (none is the fixture user's own row);
//   - the remind POST, HELD and then fulfilled 200 IN THE BROWSER, never continued, so no
//     reminder email is ever sent and no fixture row changes.
//
// Phase 88.6.1-73 adds test 4 (RF1 / D-47, plan 88.6.1-70 contract C8 d): a failed Refresh keeps
// the roster under the shared "Couldn't refresh" notice, measured IN PLACE at 375px in the phone
// project (Retry inside the viewport and at least 44 x 44, no sideways scroll, the notice between
// the heading and the first row), and a Retry that succeeds lands on the 'Responses:' heading. It
// answers the same respondents GET with a 503 (an empty JSON body) and then a 200, in the browser,
// and holds every write (support/inFlight.ts). It never answers 401 / 403: the access-answer and
// tab-return focus cases are jsdom only (ResponseDashboard.test.tsx, RD-RF-7, RD-RF-8, RD-RF-10).
// If a layout assertion fails in CI, that is a STOP for the owner's mockup, never a restyle.
//
// Phase 88.6.1-86 adds test 5 (close ruling P-14, owner 2026-10-17; Req 9): while the FIRST
// respondents GET is out, the card says the owner's loading line, inside the viewport with no
// sideways scroll, and the line leaves when the roster lands. The GET is held in the browser by a
// route registered AFTER mockDashboard (so it runs first) that hands every request on with
// route.fallback() to mockDashboard's synthetic answer, never to the backend; every write is held
// (support/inFlight.ts). The jsdom half (placement outside the pulse block, the failed-first-load
// arm) is ResponseDashboard.test.tsx, RD-L1..RD-L3. A layout failure in CI is a STOP for the
// owner, never a restyle.

// Seeded fixture group (the fixture user OWNS it, so the admin-only Remind renders) — same
// fallback idiom as padding-budget.spec.ts:69.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

const PROMPT_ID = '8861a011-0000-4000-8000-000000000011';
const MEMBERS = [
  { user_id: '8861a011-0000-4000-8000-0000000000a1', username: 'E2E pending member A' },
  { user_id: '8861a011-0000-4000-8000-0000000000b1', username: 'E2E pending member B' },
  { user_id: '8861a011-0000-4000-8000-0000000000c1', username: 'E2E pending member C' },
];

interface RemindMocks {
  /** How many remind POSTs reached the browser-side handler. */
  posts: () => number;
  /** Resolves when the first remind POST arrives (it is then held). */
  firstPostArrived: Promise<void>;
  /** Fulfils every held remind POST with a 200. */
  release: () => void;
}

/** What the respondents GET answers (plan 88.6.1-73's RF1 test switches it between calls). */
interface RespondentsAnswer {
  status: number;
  json: unknown;
}

// Plan 11's fixed answer: the three pending members above.
function threePendingMembers(): RespondentsAnswer {
  return {
    status: 200,
    json: MEMBERS.map((m) => ({
      ...m,
      has_responded: false,
      slot_count: null,
      last_reminded_at: null,
    })),
  };
}

// ONE module-local helper the tests call (plan 88.6.1-73 reuses it for its RF1 test rather than
// copying the mocks). Registered BEFORE `page.goto` so the first load is answered too.
// `respondents` (plan 88.6.1-73) is read on EVERY respondents GET, so a test can switch the answer
// between a 200 and a failure; absent, every GET gets plan 11's three members.
async function mockDashboard(
  page: Page,
  respondents: () => RespondentsAnswer = threePendingMembers,
): Promise<RemindMocks> {
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await page.route(
    (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/prompts/active`),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        json: { prompt: { id: PROMPT_ID, status: 'active', blind_voting_enabled: false, deadline } },
      });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`/prompts/${PROMPT_ID}/respondents`),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill(respondents());
    },
  );

  let posts = 0;
  const held: Route[] = [];
  let released = false;
  let markArrived!: () => void;
  const firstPostArrived = new Promise<void>((resolve) => {
    markArrived = resolve;
  });
  await page.route(
    (url) => url.pathname.includes(`/prompts/${PROMPT_ID}/remind/`),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      posts += 1;
      markArrived();
      if (released) {
        await route.fulfill({ status: 200, json: {} });
        return;
      }
      held.push(route);
    },
  );

  return {
    posts: () => posts,
    firstPostArrived,
    release: () => {
      released = true;
      for (const route of held.splice(0)) void route.fulfill({ status: 200, json: {} });
    },
  };
}

async function openDashboard(page: Page): Promise<Locator> {
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
  const heading = page.getByRole('heading', { name: /^Responses:/ });
  // A missing dashboard is a failure, never a skip (touch-targets.spec.ts idiom).
  await expect(heading).toBeVisible({ timeout: 15_000 });
  return heading.locator('xpath=..');
}

function rowOf(card: Locator, username: string): Locator {
  return card.getByRole('listitem').filter({ hasText: username });
}

type Box = { x: number; y: number; width: number; height: number };

// True when two rectangles share interior area (strict on both axes: a shared edge is not an
// overlap).
function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function measuredBox(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${what} has no layout box`).not.toBeNull();
  expect(box!.height, `${what} measured 0px tall`).toBeGreaterThan(0);
  return box!;
}

test.describe('Response dashboard Remind (plan 88.6.1-11)', () => {
  test('Remind floor: the button is at least 44px tall and its row is at most 45px', async ({ page }) => {
    await mockDashboard(page);
    const card = await openDashboard(page);
    const row = rowOf(card, MEMBERS[0].username);
    const button = row.getByRole('button');
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expect(button).toHaveCount(1);

    const buttonBox = await measuredBox(button, 'row A Remind button');
    const rowBox = await measuredBox(row, 'row A');
    expect(buttonBox.height, `Remind button ${JSON.stringify(buttonBox)}`).toBeGreaterThanOrEqual(44);
    expect(rowBox.height, `row A ${JSON.stringify(rowBox)}`).toBeLessThanOrEqual(45);
  });

  test('Remind focus: the pressed button keeps focus in flight, a second Enter sends nothing, and focus lands on "Reminded ..." after success', async ({ page }) => {
    const mocks = await mockDashboard(page);
    const card = await openDashboard(page);
    const row = rowOf(card, MEMBERS[0].username);
    const button = row.getByRole('button', { name: 'Remind', exact: true });
    await expect(button).toBeVisible({ timeout: 15_000 });

    await button.focus();
    await page.keyboard.press('Enter');
    await mocks.firstPostArrived;

    // While the POST is held: the pressed control stays focused and focusable (D-35).
    const pressed = row.getByRole('button');
    await expect(pressed).toBeFocused();
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');
    await expect(pressed).toHaveText('Sending...');

    // The per-row latch refuses a second press.
    await page.keyboard.press('Enter');
    expect(mocks.posts()).toBe(1);

    mocks.release();
    // Req 5: the success removes the button; focus lands on that row's settled text.
    await expect(row.getByText(/^Reminded \d+m ago$/)).toBeFocused();
    expect(mocks.posts()).toBe(1);
  });

  test('Remind no-overlap: no Remind tap area intersects any other control in the card (owner ruling 2026-10-05)', async ({ page }, testInfo) => {
    await mockDashboard(page);
    const card = await openDashboard(page);
    const reminds = card.getByRole('button', { name: 'Remind', exact: true });
    await expect(reminds.first()).toBeVisible({ timeout: 15_000 });

    // Guards: a smaller count FAILS, never skips (the check needs a row above and below the middle).
    expect(await card.getByRole('listitem').count()).toBeGreaterThanOrEqual(3);
    await expect(reminds).toHaveCount(3);

    if (testInfo.project.name === 'phone') {
      // The measurement is provably at phone width.
      expect(page.viewportSize()?.width).toBe(375);
    }

    const interactive = card.locator(
      'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex^="-"])',
    );
    const count = await interactive.count();
    const collected: { name: string; box: Box; isRemind: boolean; row: Locator | null }[] = [];
    for (let i = 0; i < count; i += 1) {
      const el = interactive.nth(i);
      const name = await el.evaluate(
        (node) => node.getAttribute('aria-label') ?? (node.textContent ?? '').trim(),
      );
      const box = await measuredBox(el, `interactive element ${i} ("${name}")`);
      const isRemind = name === 'Remind';
      collected.push({ name, box, isRemind, row: isRemind ? el.locator('xpath=ancestor::li[1]') : null });
    }
    const remindItems = collected.filter((c) => c.isRemind);
    expect(remindItems).toHaveLength(3);

    // Positive control FIRST: the helper and the boxes can see an overlap — each Remind box DOES
    // intersect its own row's box.
    for (const r of remindItems) {
      const rowBox = await measuredBox(r.row!, 'a Remind button\'s own row');
      expect(
        boxesIntersect(r.box, rowBox),
        `positive control: Remind ${JSON.stringify(r.box)} should intersect its row ${JSON.stringify(rowBox)}`,
      ).toBe(true);
    }

    // The ruling: no Remind box intersects any OTHER interactive element in the card.
    for (const r of remindItems) {
      for (const c of collected) {
        if (c === r) continue;
        expect(
          boxesIntersect(r.box, c.box),
          `Remind ${JSON.stringify(r.box)} overlaps "${c.name}" ${JSON.stringify(c.box)}`,
        ).toBe(false);
      }
    }
  });

  test('RF1 (plan 88.6.1-73): a failed Refresh keeps the roster under the notice, measured in place at 375px; Retry brings the roster back and lands on the heading', async ({ page }, testInfo) => {
    // Copy row RF1 / D-47 (plan 88.6.1-70's REFRESH_FAILED_NOTICE), written once in this spec.
    const RF1 = "Couldn't refresh. Showing what loaded earlier.";
    const NEW_MEMBERS = [
      { user_id: '8861a073-0000-4000-8000-0000000000d1', username: 'E2E refreshed member D' },
      { user_id: '8861a073-0000-4000-8000-0000000000e1', username: 'E2E refreshed member E' },
    ];
    // The hold FIRST, so every write that no later handler answers is held (never sent).
    const hold = await holdWrites(page);
    let answer: RespondentsAnswer = threePendingMembers();
    await mockDashboard(page, () => answer);
    const card = await openDashboard(page);
    for (const m of MEMBERS) {
      await expect(card.getByText(m.username, { exact: true })).toBeVisible({ timeout: 15_000 });
    }

    // The refresh fails with a transient answer.
    answer = { status: 503, json: {} };
    await card.getByRole('button', { name: 'Refresh', exact: true }).click();

    // The VISIBLE line: the notice renders the sentence twice, once in its sr-only polite region
    // (a div with role=status) and once in the visible <span>. `filter({ visible: true })` keeps
    // BOTH (an sr-only node still has a box), which CI run 39005519001 reported as a strict-mode
    // violation in both projects; `.and(locator('span'))` keeps only the visible span.
    const rf1Line = card.getByText(RF1, { exact: true }).and(card.locator('span'));
    await expect(rf1Line).toBeVisible({ timeout: 15_000 });
    await expect(rf1Line).toHaveCount(1);
    for (const m of MEMBERS) {
      await expect(card.getByText(m.username, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("We couldn't load the respondents.")).toHaveCount(0);

    const retry = card.getByRole('button', { name: 'Retry', exact: true });
    // A missing control fails, never skips.
    await expect(retry).toBeVisible();

    if (testInfo.project.name === 'phone') {
      // C8 (d): measured in place, provably at phone width.
      const viewport = page.viewportSize();
      expect(viewport?.width).toBe(375);
      await settleAnimations(card);
      const retryBox = await measuredBox(retry, 'the RF1 Retry');
      expect(retryBox.width, `Retry measured ${retryBox.width}px wide`).toBeGreaterThanOrEqual(44);
      expect(retryBox.height, `Retry measured ${retryBox.height}px tall`).toBeGreaterThanOrEqual(44);
      expect(retryBox.x).toBeGreaterThanOrEqual(0);
      expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(375);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, 'the page must not scroll sideways').toBeLessThanOrEqual(clientWidth);
      const lineBox = await measuredBox(rf1Line, 'the RF1 line');
      const headingBox = await measuredBox(
        card.getByRole('heading', { name: /^Responses:/ }),
        'the Responses heading',
      );
      const firstRowBox = await measuredBox(card.getByRole('listitem').first(), 'the first row');
      expect(
        lineBox.y,
        `the notice starts at ${lineBox.y}px; the heading ends at ${headingBox.y + headingBox.height}px`,
      ).toBeGreaterThanOrEqual(headingBox.y + headingBox.height);
      expect(
        lineBox.y + lineBox.height,
        `the notice ends at ${lineBox.y + lineBox.height}px; the first row starts at ${firstRowBox.y}px`,
      ).toBeLessThanOrEqual(firstRowBox.y);
    }

    // A keyboard Retry that succeeds: the notice leaves, the new roster shows, focus lands on the heading.
    answer = {
      status: 200,
      json: NEW_MEMBERS.map((m) => ({
        ...m,
        has_responded: true,
        slot_count: 1,
        last_reminded_at: null,
      })),
    };
    await retry.focus();
    await page.keyboard.press('Enter');
    for (const m of NEW_MEMBERS) {
      await expect(card.getByText(m.username, { exact: true })).toBeVisible({ timeout: 15_000 });
    }
    await expect(card.getByText(RF1, { exact: true }).filter({ visible: true })).toHaveCount(0);
    await expect(card.getByRole('heading', { name: /^Responses:/ })).toBeFocused();
    expectNoApiWrites(hold);
  });

  // Copy row P14 (close ruling P-14, plan 88.6.1-86), written once in this spec: three ASCII dots.
  const LOADING_RESPONSES = 'Loading responses...';

  test(`Loading line (plan 88.6.1-86): while the first respondents GET is out, the card says "${LOADING_RESPONSES}" inside the viewport with no sideways scroll; it leaves when the roster lands`, async ({ page }, testInfo) => {
    // The write hold FIRST, so every write that no later handler answers is held (never sent).
    const hold = await holdWrites(page);
    await mockDashboard(page);
    // Registered AFTER mockDashboard, so Playwright runs it first: it holds the FIRST respondents
    // GET until the test releases it, then hands that request and every later one to
    // mockDashboard's synthetic answer with route.fallback() (never continued to the backend).
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let respondentsGets = 0;
    await page.route(
      (url) => url.pathname.endsWith(`/prompts/${PROMPT_ID}/respondents`),
      async (route) => {
        if (route.request().method() === 'GET') {
          respondentsGets += 1;
          if (respondentsGets === 1) await firstReleased;
        }
        await route.fallback();
      },
    );

    try {
      await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
      const line = page.getByText(LOADING_RESPONSES, { exact: true });
      // A missing line is a failure, never a skip.
      await expect(line).toBeVisible({ timeout: 15_000 });
      expect(respondentsGets, 'the first respondents GET is the one being held').toBe(1);

      const viewport = page.viewportSize();
      expect(viewport, 'the page has a viewport').not.toBeNull();
      if (testInfo.project.name === 'phone') expect(viewport!.width).toBe(375);
      const lineBox = await measuredBox(line, 'the loading line');
      expect(lineBox.x, `the line starts at ${lineBox.x}px`).toBeGreaterThanOrEqual(0);
      expect(
        lineBox.x + lineBox.width,
        `the line ends at ${lineBox.x + lineBox.width}px in a ${viewport!.width}px viewport`,
      ).toBeLessThanOrEqual(viewport!.width);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, 'the page must not scroll sideways').toBeLessThanOrEqual(innerWidth);
    } finally {
      releaseFirst();
    }

    await expect(page.getByRole('heading', { name: /^Responses:/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(LOADING_RESPONSES, { exact: true })).toHaveCount(0);
    expectNoApiWrites(hold);
  });
});
