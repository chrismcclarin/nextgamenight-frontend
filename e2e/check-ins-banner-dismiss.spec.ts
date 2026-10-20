import { test, expect } from '@playwright/test';

import { E2E_GROUP_ID } from './support/groupSettings';
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

/* Phase 88.6.1 plan 79 (Req 5, D-04 / D-05 / D-07; AC-14) — the Check-ins "Heads up" banner's
   `Got it` on the group planning page, at 375px (`phone` project only).

   WHAT IT PROVES (what jsdom cannot): with the dismissal key cleared, the banner shows; `Got it`
   is inside the viewport and at least 44px tall; Enter dismisses it, and focus lands on the
   Check-ins `role="button"` header (the section's own expand control, D-05) — never `<body>`;
   nothing scrolls sideways.

   READ-ONLY: the dismissal is a `localStorage` write in this test's own browser context. No request
   writes; the shared write hold (`holdWrites`) keeps any non-GET in the browser as a backstop, and
   the afterEach fails the test if an `/api` write reached it.

   CI ONLY: the `phone` project needs `.auth/user.json` and the E2E login secrets, which exist only in
   CI (FE-TESTING-CONVENTIONS C-14). No screenshot and no attachment (DECISION 88.6-59). */

const BANNER_TITLE = 'Heads up — recurring poll behavior changed.';
const STORAGE_KEY = 'auto-prompt-behavior-banner-dismissed-v1';

let hold: WriteHold | undefined;

test.describe('Check-ins banner dismissal keeps focus (88.6.1-79)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet requirements — phone project only');

  test.beforeEach(async ({ page }) => {
    // Loud guard (precedent e2e/event-scheduler-touch.spec.ts): name the var and its producer,
    // never echo the value.
    expect(
      process.env.E2E_GROUP_ID,
      'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this spec opens a group the fixtures do not own.',
    ).toBeTruthy();
    hold = await holdWrites(page);
  });

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Got it on the Check-ins banner leaves focus on the Check-ins header (88.6.1-79)', async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.removeItem(key);
    }, STORAGE_KEY);
    await page.goto('/groupPlanning?group_id=' + E2E_GROUP_ID);

    // Vacuity guard: an unseen banner fails loudly instead of passing.
    await expect(page.getByText(BANNER_TITLE, { exact: true })).toBeVisible({ timeout: 15_000 });

    const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
    await gotIt.scrollIntoViewIfNeeded();
    await expect(gotIt).toBeInViewport();
    const box = await gotIt.boundingBox();
    expect(box, 'Got it has a layout box').not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await gotIt.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByText(BANNER_TITLE, { exact: true })).toHaveCount(0);
    // The `role="button"` header (plan 88.6.1-29's locator, `check-ins-end-focus.spec.ts`).
    await expect(page.getByRole('button', { name: /^check-ins/i })).toBeFocused();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflow, 'no sideways scroll at 375px').toBe(true);
  });
});
