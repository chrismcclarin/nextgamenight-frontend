import { test, expect, type Page, type Route } from '@playwright/test';

/* Phase 88.6.1 plan 29 — the group page's Check-ins list in a real browser, at 375px (`phone`)
   and 1280px (`journeys`).

   WHAT IT PROVES (what jsdom cannot):
   - E1 (H4, Req 5, AC-14): after a check-in is ended from its kebab, focus lands on the Check-ins
     expand control (the `role="button"` header), whose accessible name carries the new count —
     never on `<body>`.
   - E3 (W018, Req 11): with the animation-era height cap and clip deleted from the panel, the page
     gains no horizontal overflow and the panel is neither capped nor clipped.
   - E2 is RESERVED: plan 88.6.1-75 adds the AC-29 / RF1 arm here in wave 6, reusing the route
     helpers and the per-test GET mode below.

   IT NEVER WRITES TO THE BACKEND. Both the read (GET open check-ins) and the write (PATCH close)
   are fulfilled by `page.route`; every non-PATCH method on the close route goes to
   `route.fallback()`. The seeded open check-in other specs read is never closed.

   CI ONLY: the `phone` and `journeys` projects need `.auth/user.json` and the E2E login secrets,
   which exist only in CI (FE-TESTING-CONVENTIONS C-14).

   NOT HERE: R10's 375px overflow check for typed line breaks is plan 88.6.1-52's all-sites spec,
   so it is not duplicated. */

// Loud guard (precedent e2e/event-scheduler-touch.spec.ts): name the var and its producer, never
// echo the value.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this spec opens a group the fixtures do not own.',
  ).toBeTruthy();
});

const CHECK_IN_ANA = {
  id: '00000000-0000-4000-8000-0000000000a1',
  can_close: true,
  custom_message: null,
  Creator: { id: '00000000-0000-4000-8000-0000000000b1', username: 'E2E Ana' },
};
const CHECK_IN_BEN = {
  id: '00000000-0000-4000-8000-0000000000a2',
  can_close: true,
  custom_message: null,
  Creator: { id: '00000000-0000-4000-8000-0000000000b2', username: 'E2E Ben' },
};

// Per-test mutable state for the two route handlers. `getMode` decides what the open check-ins
// GET serves; plan 88.6.1-75 extends the union for its RF1 arm.
type OpenCheckInsMode = 'both' | 'ben-only';
const routeState = { getMode: 'both' as OpenCheckInsMode, patchCount: 0 };

async function mockCheckIns(page: Page) {
  routeState.getMode = 'both';
  routeState.patchCount = 0;

  await page.route('**/api/groups/*/prompts/open', async (route: Route) => {
    const prompts = routeState.getMode === 'both' ? [CHECK_IN_ANA, CHECK_IN_BEN] : [CHECK_IN_BEN];
    await route.fulfill({ status: 200, json: { prompts } });
  });

  await page.route('**/api/availability-prompts/*/close', async (route: Route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fallback();
      return;
    }
    routeState.patchCount += 1;
    // After the close, the refetch serves only Ben, as the backend would.
    routeState.getMode = 'ben-only';
    await route.fulfill({ status: 200, json: {} });
  });
}

// The Check-ins header: its accessible name starts with "Check-ins" and continues with the badge.
const checkInsHeader = (page: Page) => page.getByRole('button', { name: /^check-ins/i });
const checkInTriggers = (page: Page) =>
  page.getByRole('button', { name: 'Check-in actions', exact: true });

test('E1: ending a check-in hands focus to the Check-ins header, which announces the new count (H4)', async ({ page }) => {
  await mockCheckIns(page);
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

  // The section mounts expanded (defaultExpanded on the planning page); the header is a toggle,
  // so it is never clicked here.
  await expect(checkInTriggers(page)).toHaveCount(2);

  const triggerA = checkInTriggers(page).first();
  await triggerA.click();
  const listId = await triggerA.getAttribute('aria-controls');
  expect(listId, 'the kebab names its open list through aria-controls').toBeTruthy();
  const list = page.locator(`[id="${listId}"]`);
  await list.getByRole('button', { name: 'End check-in' }).click();
  await list.getByRole('button', { name: 'Tap again to end' }).click();

  const header = checkInsHeader(page);
  await expect(header).toBeFocused();
  await expect(header).toHaveAccessibleName(/1 open poll$/);
  await expect(checkInTriggers(page)).toHaveCount(1);
  expect(routeState.patchCount).toBe(1);
});

test('E3: the expanded Check-ins panel is neither capped nor clipped, and adds no horizontal overflow (W018)', async ({ page }) => {
  await mockCheckIns(page);
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
  await expect(checkInTriggers(page)).toHaveCount(2);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page must not scroll horizontally').toBeLessThanOrEqual(clientWidth);

  const panelId = await checkInsHeader(page).getAttribute('aria-controls');
  expect(panelId, 'the header names its panel through aria-controls').toBeTruthy();
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toBeVisible();
  const style = await panel.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
  });
  expect(style.maxHeight).toBe('none');
  expect(style.overflowY).toBe('visible');
});
