import { test, expect } from '@playwright/test';

/**
 * Phase 88.6.1 plan 27 (R7-M5, register phase-88.6.1.md:275): the Invite Members panel's
 * freeform header row sits on the Modal header's phone-first scale — 12px sides / 8px top and
 * bottom at phone width, 24px / 12px from the md breakpoint up — so a long group name gets the
 * same text-column width at 375 as every other dialog header. jsdom cannot measure padding, so
 * the geometry lives here; the class pin is in FriendInvitePanel.test.tsx (arm H).
 *
 * Both projects run it: `phone` (iPhone SE, 375 x 667) takes the isMobile arm, `journeys`
 * (desktop) the other.
 */

// DECISION Phase 88.6.1-27: no capture of any kind on this spec, chosen OVER the shared
// failure screenshot. The open panel paints the fixture group's LIVE invite QR code and link,
// and CI uploads test-results from a public repository; the setup project in
// playwright.config.ts takes no capture for the same reason. Assertion messages carry numbers
// only, never page text. Re-enabling capture here is a decision, not a cleanup.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('R7-M5: the Invite Members header row is 12px/8px at phone and 24px/12px at desktop', async ({ page, isMobile }) => {
  await page.goto('/');

  // grouplist.js names each card's invite button "Invite member to group" (plan 88.6.1-54 may
  // add the group's name after "to"), so the match stops at "to".
  const invite = page.getByRole('button', { name: /invite member to/i }).first();
  await expect(invite, 'at least 1 invite button renders for the fixture group').toBeVisible({ timeout: 15_000 });
  await invite.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog, 'the invite dialog opens').toBeVisible();

  // The title is the dialog's level-2 heading; its column's parent is the header row.
  const title = dialog.getByRole('heading', { level: 2 }).first();
  await expect(title, 'the dialog title renders').toBeVisible();
  const column = title.locator('xpath=..');
  const row = title.locator('xpath=../..');

  const padding = await row.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      left: parseFloat(cs.paddingLeft),
      right: parseFloat(cs.paddingRight),
      top: parseFloat(cs.paddingTop),
      bottom: parseFloat(cs.paddingBottom),
    };
  });
  const side = isMobile ? 12 : 24;
  const block = isMobile ? 8 : 12;
  expect(padding.left, `header padding-left px (expected ${side})`).toBe(side);
  expect(padding.right, `header padding-right px (expected ${side})`).toBe(side);
  expect(padding.top, `header padding-top px (expected ${block})`).toBe(block);
  expect(padding.bottom, `header padding-bottom px (expected ${block})`).toBe(block);

  // Positive control: the close button is still a 44 x 44 target, and the text column ends at
  // or before it.
  const close = dialog.getByRole('button', { name: 'Close' }).first();
  const closeBox = await close.boundingBox();
  const columnBox = await column.boundingBox();
  expect(closeBox, 'close button box measured').not.toBeNull();
  expect(columnBox, 'title column box measured').not.toBeNull();
  expect(closeBox!.width, 'close width px (min 44)').toBeGreaterThanOrEqual(44);
  expect(closeBox!.height, 'close height px (min 44)').toBeGreaterThanOrEqual(44);
  expect(columnBox!.x + columnBox!.width, 'title column right edge px vs close left edge px').toBeLessThanOrEqual(closeBox!.x + 0.5);

  await page.keyboard.press('Escape');
  await expect(dialog, 'the dialog closes on Escape').toBeHidden();
});
