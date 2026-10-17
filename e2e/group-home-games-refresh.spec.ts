// Phase 88.6.1-55 (Req 9, found while planning; D-09a / D-37 precedent; Req 5 focus correction) —
// group home games refresh at 375px in a real browser (the `phone` project, iPhone SE 375 x 667).
//
// What this proves that jsdom cannot: in a real browser at phone width, with React's real
// re-render and the house banner's real in-flight label, pressing "Try again" on the group's games
// banner keeps the whole page on screen while the retry is in flight. Before this plan every games
// refresh set the page-wide loader, so the page was replaced by "Loading games..." (and the
// banner, its "Retrying…" label and the focused button went with it) until the request returned.
// The red half is GR-2 in src/app/groupHomePage/groupHomePage.identity.test.tsx (jsdom); GR-1,
// GR-3 and GR-4 there cover the event-created refresh, a group switch and newest-wins.
//
// It runs in CI only: the phone project needs the `.auth` storage state, which does not exist
// locally (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
//
// Shared-fixture rules: the seeded group is shared with other specs, so this spec only READS.
// Every write is held in the browser by holdWrites (registered before navigation) and none is
// pressed; the games intercept touches GETs only. The first load's games GET is answered in the
// browser with one synthetic 500; the retry GET is held, then continued to the real backend
// unchanged. No response body is logged, printed or attached.
//
// DECISION Phase 88.6.1-55 (Req 9 phone arm): a spec-local fail-then-hold-then-continue route,
// chosen OVER the shared holdUntilReleased helper in e2e/support/inFlight.ts, which answers the
// held request in the browser with a JSON body; this spec must let the retry reach the real
// backend so the banner clears on a real answer. Changing this is a decision, not a cleanup.
import { test, expect, type Route } from '@playwright/test';

import { holdWrites } from './support/inFlight';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// GroupGamesList's banner title (existing copy, read only).
const GAMES_TITLE = "We couldn't load this group's games";

// The browser calls the same-origin BFF: `GET /api/lists/games/<group id>/<self uuid>?…`
// (src/lib/api.ts, getGroupGames).
const isGroupGamesRead = (url: URL) => url.pathname.includes(`/lists/games/${E2E_GROUP_ID}/`);

test.describe('group home games refresh — phone', () => {
  // Both projects glob every spec, so the guard is explicit.
  test.skip(
    ({ isMobile }) => !isMobile,
    'phone-project block — the fix is viewport-independent; jsdom GR-1..GR-4 cover the logic',
  );

  test.beforeEach(async ({ page }) => {
    await holdWrites(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Try again on the games banner keeps the group page on screen while the retry is in flight', async ({
    page,
  }) => {
    let mode: 'fail' | 'hold' | 'pass' = 'fail';
    let markArrived!: () => void;
    const arrived = new Promise<void>((resolve) => {
      markArrived = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Registered after holdWrites, so it runs first on a games read; any other method falls back
    // into the hold.
    await page.route(isGroupGamesRead, async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (mode === 'fail') {
        // Every games GET in this mode (robust to a duplicated first request).
        await route.fulfill({ status: 500, json: { code: 'internal', message: 'Simulated games failure' } });
        return;
      }
      if (mode === 'hold') {
        mode = 'pass';
        markArrived();
        await released;
        await route.continue();
        return;
      }
      await route.continue();
    });

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    // D-11 dark-theme pre-assertion (the feedback-stacking.spec.ts idiom): the reused storage
    // state can carry a stored theme key, so assert the theme before anything visual.
    await expect(page.locator('html')).toHaveClass(/dark/);

    await expect(page.getByText(GAMES_TITLE, { exact: true })).toBeVisible({ timeout: 15_000 });
    const planLink = page.getByRole('link', { name: 'Plan Game Session' });
    await expect(planLink).toBeVisible();

    mode = 'hold';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await arrived;

    // The retry GET is in flight and held. POSITIVE first: the banner is still mounted, showing
    // its in-flight label (before this plan the page blanked and the banner was gone).
    await expect(page.getByRole('button', { name: 'Retrying…', exact: true })).toBeVisible();
    await expect(planLink).toBeVisible();
    await expect(page.getByText('Loading games...', { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'the group page scrolls sideways at 375px during the retry',
    ).toBe(true);

    release();
    await expect(page.getByText(GAMES_TITLE, { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
