import { test, expect } from '@playwright/test';
import { holdWrites } from './support/inFlight';

// Phase 88.6.1-45 (AC-18 + D-08a, copy row H5) — the header's one Main navigation landmark and
// the layered Escape, in a real browser.
//
// What this checks that jsdom cannot:
//   - the App Router hydrates React on the DOCUMENT (the next package's dist/client/app-index.js
//     sets its app element to document), so the bell's claimed Escape reaches Header's document
//     listener on the SAME node as React's root. The unit suite (src/app/Header.test.tsx HD-1)
//     only models that order; here the real composition runs.
//   - real layout at 375px: the Main landmark must sit inside the viewport and the page must not
//     scroll sideways.
//
// Runs in CI only (the e2e job on the phase PR). Locally there is no .auth storageState, so this
// file is typechecked (tsconfig.e2e.json) and listed, never run.
//
// This spec owns the hamburger-state assertion after an Escape that plan 88.6.1-28's
// e2e/notification-bell-panel.spec.ts deliberately leaves out.
//
// SELECTOR POLICY: roles and names, never Tailwind classes. The one exception is the attribute
// locators that count the landmark itself (a nav named Main; a nav with no name at all).

const MAIN_NAV = 'nav[aria-label="Main"]';
const UNNAMED_NAV = 'nav:not([aria-label]):not([aria-labelledby])';

test.describe('header main nav — phone (375, the hamburger)', () => {
  // Runs ONLY in the phone project. Both journeys and phone glob every e2e/*.spec.ts, so each
  // describe is guarded in both directions (the e2e/feedback-stacking.spec.ts shape).
  test.skip(({ isMobile }) => !isMobile, 'phone-project block — desktop coverage lives in the describe below');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // D-11 dark-theme pre-assertion (e2e/feedback-stacking.spec.ts): the reused storageState can
    // carry a stored theme key that outranks the config's colorScheme.
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('header main nav — phone: one Main landmark at 375 that holds the menu links', async ({ page }) => {
    await expect(page.locator(MAIN_NAV)).toHaveCount(1);
    await expect(page.locator(UNNAMED_NAV)).toHaveCount(0);

    const viewport = page.viewportSize();
    expect(viewport, 'the phone project must define a viewport').not.toBeNull();
    const box = await page.locator(MAIN_NAV).boundingBox();
    expect(box, 'the Main landmark must have a layout box').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'the page must not scroll sideways at 375').toBeLessThanOrEqual(overflow.innerWidth);

    const menuButton = page.getByRole('button', { name: 'Toggle menu' });
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Friends', exact: true }),
    ).toBeVisible();
  });

  test('header main nav — phone: one Escape with the bell open closes the bell only, the next closes the menu', async ({ page }) => {
    const menuButton = page.getByRole('button', { name: 'Toggle menu' });
    const row = page.getByRole('button', { name: 'Invites notifications', exact: true });
    const region = page.getByRole('region', { name: 'Notifications', exact: true });
    const friends = page
      .getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('link', { name: 'Friends', exact: true });

    // 88.6.1 code review A-02: the panel needs a focusable row action so focus can sit INSIDE it
    // when Escape is pressed (focus left on the row made `toBeFocused(row)` pass with the restore
    // deleted). The pending-invites read is answered in the browser with one synthetic invite by
    // the shared holdWrites net, which also holds every write; it must be registered before a
    // navigation, so the page is loaded again here.
    await holdWrites(page, {
      answerGet: (url) =>
        url.pathname.endsWith('/invites/pending')
          ? [{ id: 'e2e-nav-invite', Group: { name: 'E2E Nav Escape' }, Inviter: { username: 'E2E Host' } }]
          : undefined,
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/dark/);

    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await row.click();
    await expect(region).toBeVisible();

    // First Escape: the bell claims it (useDismissal default-prevents it) and Header bails.
    const action = region.getByRole('button', { name: 'Accept invite to E2E Nav Escape', exact: true });
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(region).toHaveCount(0);
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(friends).toBeVisible();
    await expect(row).toBeFocused();

    // Second Escape: nothing claims it, so the hamburger closes and focus returns to its toggle.
    await page.keyboard.press('Escape');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(menuButton).toBeFocused();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('header main nav — desktop (the inline list)', () => {
  // Runs ONLY in the journeys project — same both-directions guard as above.
  test.skip(({ isMobile }) => isMobile, 'desktop-project block — phone coverage lives in the describe above');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // D-11 dark-theme pre-assertion (e2e/feedback-stacking.spec.ts).
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('header main nav — desktop: one Main landmark holds the primary links', async ({ page }) => {
    await expect(page.locator(MAIN_NAV)).toHaveCount(1);
    const main = page.getByRole('navigation', { name: 'Main', exact: true });
    for (const name of ['Home', 'Friends', 'Profile', 'Logout']) {
      await expect(main.getByRole('link', { name, exact: true })).toBeVisible();
    }
  });
});
