import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

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

// ONE module-local helper the tests call (plan 88.6.1-73 reuses it for its RF1 test rather than
// copying the mocks). Registered BEFORE `page.goto` so the first load is answered too.
async function mockDashboard(page: Page): Promise<RemindMocks> {
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
      await route.fulfill({
        status: 200,
        json: MEMBERS.map((m) => ({
          ...m,
          has_responded: false,
          slot_count: null,
          last_reminded_at: null,
        })),
      });
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
});
