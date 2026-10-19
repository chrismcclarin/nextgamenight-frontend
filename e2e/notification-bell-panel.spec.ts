import { test, expect } from '@playwright/test';
import { holdWrites } from './support/inFlight';

// Phase 88.6.1-28 (D-18, AC-17, register R128) — the notification bell's panel in a real browser.
//
// What this checks that jsdom cannot:
//   - the App Router hydrates the DOCUMENT (node_modules/next/dist/client/app-index.js:42,
//     const appElement = document;), so React's root listener and Header's document Escape
//     listener (src/app/Header.js:31-42) share one node. Under Testing Library the React root is
//     a div, so the unit suite only models that order (NB-6); here the real composition runs.
//   - real layout at 375px: the row variant's panel renders inline inside the phone hamburger
//     (src/app/Header.js:302, variant="row" label="Invites") and must fit the viewport width.
//   - real focus movement: Chromium sets relatedTarget on a focus move, so focus leaving the bell
//     is a genuine focusout, not a synthetic one.
//
// Runs in CI only (the e2e job on the phase PR). Locally there is no .auth storageState, so this
// file is typechecked (tsconfig.e2e.json) and listed, never run.
//
// The hamburger's own state after an Escape is plan 88.6.1-45's assertion (D-08a: Header bails
// on a default-prevented Escape), NOT this spec's — the phone test deliberately asserts nothing
// about whether the menu stayed open.
//
// 88.6.1 code review A-02: the Escape arms move focus INTO the open region first, onto a row
// action, and only then press Escape. The bell never moves focus on open, so an Escape pressed
// with focus still on the trigger passed with the focus restore deleted. Focus inside the panel
// is the keyboard user's case (WCAG 2.4.3): the focused control unmounts with the panel and
// focus must come back to the trigger. The pending-invites list is answered in the browser with
// one synthetic invite (the shared holdWrites net, which also holds every write, so nothing this
// spec does reaches the shared CI database), so the panel always has a focusable row action.
const PANEL_INVITE = {
  id: 'e2e-bell-panel-invite',
  Group: { name: 'E2E Bell Panel' },
  Inviter: { username: 'E2E Host' },
};
const answerPendingInvites = (url: URL): unknown =>
  url.pathname.endsWith('/invites/pending') ? [PANEL_INVITE] : undefined;
const PANEL_ACTION = 'Accept invite to E2E Bell Panel';

test.describe('notification bell panel — phone (row variant in the hamburger)', () => {
  // Runs ONLY in the phone project. Both journeys and phone glob every e2e/*.spec.ts, so each
  // describe is guarded in both directions (the e2e/feedback-stacking.spec.ts shape).
  test.skip(({ isMobile }) => !isMobile, 'phone-project block — desktop coverage lives in the describe below');

  test.afterEach(async ({ page }) => {
    // The held writes are never answered; drop the net before teardown (the bell-actions shape).
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test.beforeEach(async ({ page }) => {
    // Registered BEFORE the first navigation (inFlight.ts: a route added after goto misses the load).
    await holdWrites(page, { answerGet: answerPendingInvites });
    await page.goto('/');
    // D-11 dark-theme pre-assertion (e2e/feedback-stacking.spec.ts): the reused storageState can
    // carry a stored theme key that outranks the config's colorScheme.
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('notification bell panel — phone: the Invites row opens a region named Notifications that fits 375px, and closes when focus leaves and on Escape', async ({ page }) => {
    const menuButton = page.getByRole('button', { name: 'Toggle menu' });
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    const row = page.getByRole('button', { name: 'Invites notifications', exact: true });
    const region = page.getByRole('region', { name: 'Notifications', exact: true });

    // Opens a named region that fits inside the phone viewport.
    await row.click();
    await expect(region).toBeVisible();
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project must define a viewport').not.toBeNull();
    const box = await region.boundingBox();
    expect(box, 'the open region must have a layout box').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    // Focus leaving the bell (to the hamburger toggle, outside the bell's container) closes it.
    await row.focus();
    await menuButton.focus();
    await expect(region).toHaveCount(0);

    // Reopen, move focus INTO the panel, then Escape closes it and focus comes back to the row
    // (A-02: the focused row action unmounts with the panel, so only the restore puts focus there).
    await row.click();
    await expect(region).toBeVisible();
    const action = region.getByRole('button', { name: PANEL_ACTION, exact: true });
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(region).toHaveCount(0);
    await expect(row).toBeFocused();
  });
});

test.describe('notification bell panel — desktop (icon variant in the nav)', () => {
  // Runs ONLY in the journeys project — same both-directions guard as above.
  test.skip(({ isMobile }) => isMobile, 'desktop-project block — phone coverage lives in the describe above');

  test.afterEach(async ({ page }) => {
    // The held writes are never answered; drop the net before teardown (the bell-actions shape).
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test.beforeEach(async ({ page }) => {
    await holdWrites(page, { answerGet: answerPendingInvites });
    await page.goto('/');
    // D-11 dark-theme pre-assertion (e2e/feedback-stacking.spec.ts).
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('notification bell panel — desktop: Escape closes the region and focus returns to the bell', async ({ page }) => {
    const bell = page.getByRole('button', { name: 'Notifications', exact: true });
    const region = page.getByRole('region', { name: 'Notifications', exact: true });

    await bell.click();
    await expect(region).toBeVisible();

    // A-02: focus moves INTO the region before the Escape, so the last assertion can fail.
    const action = region.getByRole('button', { name: PANEL_ACTION, exact: true });
    await action.focus();
    await expect(action).toBeFocused();
    await expect(bell).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(region).toHaveCount(0);
    await expect(bell).toBeFocused();
  });
});
