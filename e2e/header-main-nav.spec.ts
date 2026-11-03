import { test, expect, type Locator, type Page } from '@playwright/test';
import { holdWrites } from './support/inFlight';
import { answerPendingInvites, pendingInvite } from './support/pendingInvite';
import { assertTheme, describeRatio, focusRingMeasurement, forceLightMode, haloGroundRatio } from './support/contrast';

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

// Phase 88.9-04 — the 1280 half of A10c: the desktop brand link and one inline list link wear the
// house offset ring, and its halo is the header ground. Red by design: pre-fix both links wear the
// UA outline, so focusRingMeasurement throws on an empty --tw-ring-color (the phone brand-link twin
// is in e2e/contrast.spec.ts ("async function brandLinkRing(")).
const RING_FLOOR = 3;
const HALO_EQUAL = 1.01;

async function expectHouseRing(page: Page, link: Locator, label: string): Promise<void> {
  await expect(link, `${label}: the link is not visible.`).toBeVisible();
  const m = await focusRingMeasurement(page, link, label);
  expect(m.ratio, describeRatio(label, RING_FLOOR, m)).toBeGreaterThanOrEqual(RING_FLOOR);
  const h = await haloGroundRatio(m, link);
  expect(
    h.ratio,
    `${label}: the ring halo ${h.halo} measured ${h.ratio.toFixed(3)}:1 against the surface under the control ` +
      `${h.behind}; the house ring's halo must equal the surface (<= ${HALO_EQUAL}:1).`
  ).toBeLessThanOrEqual(HALO_EQUAL);
}

async function desktopLinkRings(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const main = page.getByRole('navigation', { name: 'Main', exact: true });
  await test.step(`the brand link (${theme})`, async () => {
    // The logo SVG's aria-label joins the link's accessible name, so the name is matched by a regex.
    const brand = main.getByRole('link', { name: /Next Game Night/ });
    await expectHouseRing(page, brand, `desktop header brand link focus ring (A10c, ${theme})`);
  });
  await test.step(`a desktop list link — Friends (${theme})`, async () => {
    const friends = main.getByRole('link', { name: 'Friends', exact: true });
    await expectHouseRing(page, friends, `desktop header Friends link focus ring (A10c, ${theme})`);
  });
}

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
      answerGet: answerPendingInvites([pendingInvite('e2e-nav-invite', 'E2E Nav Escape')]),
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
  test('A10c (88.9): the desktop brand link and a list link wear the house ring on a header halo, dark', async ({ page }) => {
    await desktopLinkRings(page, 'dark');
  });
});

test.describe('header main nav — desktop, light (88.9)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-project block — the phone light twin lives in e2e/contrast.spec.ts');
  // Both projects bake dark; colorScheme alone does not set the class, so forceLightMode writes the
  // stored theme before the first navigation and assertTheme proves it after.
  test.use({ colorScheme: 'light' });

  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
    await page.goto('/');
    await assertTheme(page, 'light');
  });

  test('A10c (88.9): the desktop brand link and a list link wear the house ring on a header halo, light', async ({ page }) => {
    await desktopLinkRings(page, 'light');
  });
});
