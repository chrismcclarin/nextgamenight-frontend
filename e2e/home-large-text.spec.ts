// Home at normal text after the large-text work of Phase 89.6-16 (H-01, O-M4 Fixed+, the Create ring).
//
// WHAT. One test, phone first, at 375 x 667 then 320 x 568 with 100% text: the "+ Create New Group"
// button is one line tall (the 44px floor holds one line; a second line makes it taller) and its
// focus ring is drawn whole (no ancestor clips the button box grown by the ring's reach); the first
// card's gear is 46 x 44 with a 20px icon (owner pick O-M4 = Fixed+: the box stays, the icon grows
// with the text up to 32px, so at normal text it is the 20px it was); and a seeded card's title and
// its players pill share a line (their vertical centres within 1px). The 200% and font32 halves of
// the same reads are the R01 row's extras in the large-text sweep
// (e2e/support/largeTextSurfaces/home.ts ("export async function expectRingWhole")).
//
// READ-ONLY. The sweep's write guard is registered before the first navigation
// (e2e/support/largeTextSurfaces/index.ts ("export async function sweepWriteGuard")): every
// non-GET on every URL is held in the browser, the self read is sent on without its timezone
// parameter (the backend's time zone backfill cannot run), and a GET that writes is held and
// listed. Nothing here presses anything; focusing the Create button sends nothing. The afterEach
// asserts no write reached the hold and no writing GET was held, and never calls unrouteAll
// (turning interception off resumes the requests the hold is holding: the 88.9-03 leak).
//
// WHERE. Both projects, no conditional skip; the test sets its own viewport. Its rows in
// scripts/gate-c-floors.manifest.mjs exist so a green CI run prints one line per project naming this
// spec (CI prints nothing per passing test). CI ONLY: both projects need the stored sign-in.
import { test, expect, type Locator, type Page } from '@playwright/test';

import { expectNoApiWrites } from './support/inFlight';
import { expectRingWhole } from './support/largeTextSurfaces/home';
import { sweepWriteGuard, type SweepHold } from './support/largeTextSurfaces/index';

let hold: SweepHold | undefined;

test.afterEach(() => {
  expectNoApiWrites(hold);
  expect(hold?.writeGets ?? [], 'a GET that writes was held with no answer').toEqual([]);
  hold = undefined;
});

async function box(locator: Locator): Promise<{ width: number; height: number; centreY: number }> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, centreY: rect.top + rect.height / 2 };
  });
}

async function readAt(page: Page, width: number, height: number): Promise<void> {
  const tag = `${width} x ${height}, 100% text`;
  await page.setViewportSize({ width, height });
  const create = page.getByRole('button', { name: 'Create new group' }).first();
  await expect(create, `${tag}: no Create button`).toBeVisible();
  const createBox = await box(create);
  expect(createBox.height, `${tag}: the Create label is more than one line (${createBox.height}px tall)`).toBeLessThanOrEqual(44.5);
  await expectRingWhole(page, create, `${tag}: the Create button`);

  const gears = page.getByRole('button', { name: /^Customize / });
  expect(await gears.count(), `${tag}: no group card gear`).toBeGreaterThanOrEqual(1);
  const gear = gears.first();
  const gearBox = await box(gear);
  expect(Math.abs(gearBox.width - 46), `${tag}: the gear is ${gearBox.width}px wide, not 46`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(gearBox.height - 44), `${tag}: the gear is ${gearBox.height}px tall, not 44`).toBeLessThanOrEqual(0.5);
  const icon = await box(gear.locator('svg').first());
  expect(Math.abs(icon.width - 20), `${tag}: the gear icon is ${icon.width}px wide, not 20`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(icon.height - 20), `${tag}: the gear icon is ${icon.height}px tall, not 20`).toBeLessThanOrEqual(0.5);

  const card = page.getByTestId('group-card').first();
  const pill = card.getByText(/^\d+ players?$/).first();
  // The title is the card's first focusable with role button (the group name is its name).
  const title = card.getByRole('button').first();
  const [titleBox, pillBox] = [await box(title), await box(pill)];
  expect(Math.abs(titleBox.centreY - pillBox.centreY), `${tag}: the title and the players pill are not on one line`).toBeLessThanOrEqual(1);
}

test('89.6-16 normal text: at 375 x 667 then 320 x 568 with 100% text, the Create label is one line and its focus ring is whole, the gear is 46 x 44 with a 20px icon, and a seeded title and its players pill share a line', async ({ page }) => {
  hold = await sweepWriteGuard(page, {});
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Your Groups' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('group-card').first()).toBeVisible({ timeout: 15_000 });
  await readAt(page, 375, 667);
  await readAt(page, 320, 568);
});
