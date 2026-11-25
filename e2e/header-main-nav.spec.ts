import { test, expect, type Locator, type Page } from '@playwright/test';
import { holdWrites } from './support/inFlight';
import { answerPendingInvites, pendingInvite } from './support/pendingInvite';
import {
  assertTheme,
  C40_BAND,
  compositeGround,
  contrastRatio,
  describeRatio,
  describeRing,
  focusRingMeasurement,
  forceLightMode,
  probeElement,
} from './support/contrast';

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
// house offset ring. Red by design before that fix: both links wore the browser's outline, so the
// reader throws "the browser's own outline" (the phone brand-link twin is in
// e2e/contrast.spec.ts ("async function brandLinkRing(")).
// AMENDED Phase 89.6-14 (O-1 B): the halo-equals-the-header-ground clause is replaced by the band
// read: the two bands are C40-apart (bandRatio >= C40_BAND), and lane R's O-1 rule holds on the
// real ground and fill (m.ratio >= 3).
const RING_FLOOR = 3;

async function expectHouseRing(page: Page, link: Locator, label: string): Promise<void> {
  await expect(link, `${label}: the link is not visible.`).toBeVisible();
  const m = await focusRingMeasurement(page, link, label);
  expect(m.ratio, describeRatio(label, RING_FLOOR, m)).toBeGreaterThanOrEqual(RING_FLOOR);
  expect(m.bandRatio, describeRing(label, m)).toBeGreaterThanOrEqual(C40_BAND);
}

async function desktopLinkRings(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const main = page.getByRole('navigation', { name: 'Main', exact: true });
  await test.step(`the brand link (${theme})`, async () => {
    // Matched by a regex from when the logo carried a label of its own (decoration since 88.9-52; the pattern still holds).
    const brand = main.getByRole('link', { name: /Next Game Night/ });
    await expectHouseRing(page, brand, `desktop header brand link focus ring (A10c, ${theme})`);
  });
  await test.step(`a desktop list link — Friends (${theme})`, async () => {
    const friends = main.getByRole('link', { name: 'Friends', exact: true });
    await expectHouseRing(page, friends, `desktop header Friends link focus ring (A10c, ${theme})`);
  });
}

// Phase 88.9-57 — 52-X15 (owner pick N03 B, 2026-11-11): the desktop theme toggle hovers like the
// bell beside it. White glyph at rest, amber-400 on hover, and no wash behind it, in both themes.
// Red by design before the fix: in dark the sun rests amber, and in light the moon's own white
// class keeps it white under the pointer while a translucent wash paints behind it.
// Colours are read through probeElement's normaliser, so the form Chromium serialises does not matter.
const INK_WHITE = 'rgb(255, 255, 255)';
const INK_AMBER_400 = 'rgb(251, 191, 36)';
const GLYPH_FLOOR = 3;

async function toggleHoversLikeTheBell(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const label = `desktop theme toggle hover (X15, ${theme})`;
  const main = page.getByRole('navigation', { name: 'Main', exact: true });
  const toggle = main.getByRole('button', { name: /^Switch to (light|dark) mode$/ });
  await expect(toggle, `${label}: the Main landmark must hold exactly one visible theme toggle at 1280.`).toHaveCount(1);
  const glyph = toggle.locator('svg');
  const ink = async (): Promise<string | null> => (await probeElement(glyph, ['color'])).computed['color']?.css ?? null;
  const fill = async (): Promise<string> =>
    (await probeElement(toggle, ['background-color'])).computed['background-color']?.raw ?? '';

  // The pointer is parked well below the sticky header, so the first read is the resting state.
  await page.mouse.move(8, 600);
  await expect.poll(ink, { message: `${label}: the glyph at rest must be white, the bell's resting ink.` }).toBe(INK_WHITE);
  const restFill = await fill();

  await toggle.hover();
  await expect
    .poll(ink, { message: `${label}: the glyph under the pointer must be amber-400, the bell's hover ink.` })
    .toBe(INK_AMBER_400);
  const hoverFill = await fill();
  expect(hoverFill, `${label}: the button background changed on hover (${restFill} to ${hoverFill}); the pick is no wash.`).toBe(restFill);

  const ground = compositeGround(await probeElement(toggle, []), 0);
  expect(ground, `${label}: the ground walk under the toggle never reached an opaque surface.`).not.toBeNull();
  const ratio = contrastRatio(INK_AMBER_400, ground);
  expect(ratio, `${label}: no ratio from ${INK_AMBER_400} on ${ground}.`).not.toBeNull();
  // eslint-disable-next-line no-console -- the measured ratio is recorded from the CI log
  console.log(`${label}: hovered glyph ${INK_AMBER_400} on ${ground} ${ratio!.toFixed(2)}:1 (${ratio}); background ${hoverFill}`);
  expect(
    ratio!,
    `${label}: the hovered glyph ${INK_AMBER_400} on the header ground ${ground} is ${ratio!.toFixed(2)}:1, floor ${GLYPH_FLOOR}:1.`
  ).toBeGreaterThanOrEqual(GLYPH_FLOOR);
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
  test('X15 (88.9-57): the desktop theme toggle hovers like the bell — white at rest, amber-400 on hover, no wash, dark', async ({ page }) => {
    await toggleHoversLikeTheBell(page, 'dark');
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
  test('X15 (88.9-57): the desktop theme toggle hovers like the bell — white at rest, amber-400 on hover, no wash, light', async ({ page }) => {
    await toggleHoversLikeTheBell(page, 'light');
  });
});
