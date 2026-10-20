import { test, expect } from '@playwright/test';

// Phase 88.6.1 plan 16 (D-25, copy row G6): the planning page tells a failed ROLE read, seen on a
// phone at 375 x 667.
//
// WHY THIS FILE EXISTS. Before 88.6.1-16 a failed members read on the planning page was swallowed:
// every admin control (the poll schedule tools, the response dashboard's admin actions) simply
// vanished with no word to the user. The page now shows the shipped compact notice ("Some personal
// controls are unavailable.") with a Retry. The jsdom suite (`src/app/groupPlanning/page.test.tsx`,
// arms R1-R6) proves the content, the one live region and the retry outcome; jsdom evaluates no
// layout, so THIS spec is where the notice is proven on a phone: exactly one visible line, inside
// the viewport, no page-level horizontal scroll, and Retry clears it.
//
// NOT RUN LOCALLY. The `phone` project depends on the `setup` project, which drives Auth0 Universal
// Login with credentials `playwright.config.ts` records as deliberately absent locally, and there is
// no `.auth/user.json` in the tree (C-14 in .planning/codebase/FE-TESTING-CONVENTIONS.md).
// Collection and typecheck are the only local proof this file has; the CI e2e job is the proof.
//
// SYNTHETIC FAILURE, NO REAL DATA. The route answers the browser's members GET with a 500 and a
// small made-up body while a flag is set; every other request, and every request once the flag is
// cleared, continues to the real backend unchanged. Nothing is written.

// Seeded fixture minted by the backend's scripts/e2e-fixtures.js in CI — the padding-budget idiom.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// Copy row G6: the shipped COMPACT_NOTICE (src/components/ui/FetchErrorBanner.tsx), no new string.
const G6_NOTICE = 'Some personal controls are unavailable.';

test.describe('groupPlanning — a failed role read on a phone (88.6.1-16, D-25 / G6)', () => {
  // Runs ONLY in the `phone` project (the padding-budget idiom): both `journeys` and `phone`
  // collect every e2e spec, so this is a runtime skip, not a collection filter.
  test.skip(({ isMobile }) => !isMobile, 'G6 at 375px: this spec measures the PHONE viewport only');

  test('the personal controls notice shows once inside the 375px viewport, and Retry clears it', async ({ page }) => {
    let failMembers = true;
    // The members read is `groupsAPI.getGroupMembers` -> GET `/groups/<id>/users` (src/lib/api.ts),
    // reached through the BFF proxy.
    await page.route(
      (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`),
      async (route) => {
        if (route.request().method() !== 'GET' || !failMembers) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'synthetic failure (88.6.1-16 e2e)' }),
        });
      },
    );

    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    // The VISIBLE line is a span; the announcing region beside it is an sr-only div, so this
    // locator cannot match the region.
    const line = page.locator('span', { hasText: G6_NOTICE });
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line).toHaveCount(1);

    const box = await line.boundingBox();
    expect(box, 'the notice line has no layout box').not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project has no viewport').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

    failMembers = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(line).toBeHidden({ timeout: 15_000 });
  });
});
