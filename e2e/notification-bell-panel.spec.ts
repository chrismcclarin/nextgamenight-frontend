import { test, expect, type Page } from '@playwright/test';
import { holdWrites } from './support/inFlight';
import { answerPendingInvites, pendingInvite } from './support/pendingInvite';
import { assertTheme, describeRatio, focusRingMeasurement, forceLightMode, haloGroundRatio } from './support/contrast';

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
// The invite shape and its answerer are the shared e2e/support/pendingInvite.ts module (Phase 88.9-01).
const PANEL_INVITE = pendingInvite('e2e-bell-panel-invite', 'E2E Bell Panel');
const PANEL_ACTION = 'Accept invite to E2E Bell Panel';

// Phase 88.9-04 — the 1280 half of A3d: the desktop popover's Accept ring, both themes.
// Red by design until plan 88.9-05 lands the house ring (pre-fix the ring reads 1.67:1 on its white
// halo in both themes). haloGroundRatio reads the surface from the control's PARENT, so an
// opaque-fill Accept is compared with the panel card, never with its own fill (e2e/support/contrast.ts ("this helper probes the parent")).
const RING_FLOOR = 3;
const HALO_EQUAL = 1.01;

async function desktopAcceptRing(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  const region = page.getByRole('region', { name: 'Notifications', exact: true });
  await bell.click();
  await expect(region, `A3d desktop (${theme}): the Notifications region did not open.`).toBeVisible();
  const action = region.getByRole('button', { name: PANEL_ACTION, exact: true });
  await expect(action, `A3d desktop (${theme}): the synthetic invite's Accept action is not visible.`).toBeVisible();
  // Focus INSIDE the panel first: focusRingMeasurement presses Tab to set keyboard modality, and
  // from the bell that Tab could leave the trigger and close the panel.
  await action.focus();
  const label = `desktop bell popover Accept focus ring (A3d, ${theme})`;
  const m = await focusRingMeasurement(page, action, label);
  expect(m.ratio, describeRatio(label, RING_FLOOR, m)).toBeGreaterThanOrEqual(RING_FLOOR);
  const h = await haloGroundRatio(m, action);
  expect(
    h.ratio,
    `${label}: the ring halo ${h.halo} measured ${h.ratio.toFixed(3)}:1 against the surface under the control ` +
      `${h.behind}; the house ring's halo must equal the surface (<= ${HALO_EQUAL}:1).`
  ).toBeLessThanOrEqual(HALO_EQUAL);
}

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
    await holdWrites(page, { answerGet: answerPendingInvites([PANEL_INVITE]) });
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
    await holdWrites(page, { answerGet: answerPendingInvites([PANEL_INVITE]) });
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
  test('A3d (88.9): the desktop bell popover Accept ring clears 3:1 and its halo is the card, dark', async ({ page }) => {
    await desktopAcceptRing(page, 'dark');
  });
});

test.describe('notification bell panel — desktop, light (88.9)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-project block — the phone light twin lives in e2e/contrast.spec.ts');
  // Both projects bake dark; colorScheme alone does not set the class, so forceLightMode writes the
  // stored theme before the first navigation and assertTheme proves it after.
  test.use({ colorScheme: 'light' });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
    await holdWrites(page, { answerGet: answerPendingInvites([PANEL_INVITE]) });
    await page.goto('/');
    await assertTheme(page, 'light');
  });

  test('A3d (88.9): the desktop bell popover Accept ring clears 3:1 and its halo is the card, light', async ({ page }) => {
    await desktopAcceptRing(page, 'light');
  });
});
