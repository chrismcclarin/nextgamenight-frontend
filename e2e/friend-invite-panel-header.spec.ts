import { test, expect } from '@playwright/test';

import { settleAnimations } from './support/inFlight';

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
// [AMENDED 2026-10-25, code review A-IN-03: since Phase 88.6.2-27 test-results leave CI only
// as age ciphertext (scripts/encrypt-evidence.sh), readable by the key holder alone, so the
// public-download premise above no longer holds. The choice stands: capture this spec does not
// need would still put a live invite link into a retained artifact, and the encryption is a
// second net, not a reason to take the capture.]
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('R7-M5: the Invite Members header row is 12px/8px at phone and 24px/12px at desktop', async ({ page, isMobile }) => {
  await page.goto('/');

  // grouplist.js names each card's invite button "Invite member to {group}" (plan 88.6.1-54,
  // D-19; "Invite member to group" when a group has no name), so the match stops at "to".
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
  // Wait for the open animation first. The dialog opens with dialog.tsx's `zoom-in-95` over
  // `duration-200`, and boundingBox() reads the TRANSFORMED box, so a read mid-animation measured
  // the 44px button at 43.35-43.96px in CI (run 38878098281, both projects). The padding reads
  // above use computed style, which a transform does not touch. Infinite animations (a spinner)
  // are skipped, since their `finished` never settles; a cancelled one rejects, and is treated as
  // done (a cancelled animation no longer transforms anything).
  await settleAnimations(dialog);
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

// Phase 88.9-29 (owner picks C6a, E8b and O13a; UI-SPEC R2-15, R2-75, O-13). jsdom computes no
// line height, alignment or padding, so the rendered half of those rulings lives here, at 375
// (phone) and desktop (journeys). It inherits this file's capture-off test.use above; its
// messages carry numbers only. The letter-spacing arm reads 0 from Task 1 onward (the
// DialogTitle base dropped its tracking there); the others are red until the panel is edited.
test('C6a + E8b + O13a (88.9): the invite title takes a 25px line, the close centres on the title block, body sections are 16px at phone and 20px at desktop', async ({ page, isMobile }) => {
  await page.goto('/');

  const invite = page.getByRole('button', { name: /invite member to/i }).first();
  await expect(invite, 'at least 1 invite button renders for the fixture group').toBeVisible({ timeout: 15_000 });
  await invite.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog, 'the invite dialog opens').toBeVisible();
  await settleAnimations(dialog);

  const title = dialog.getByRole('heading', { level: 2 }).first();
  await expect(title, 'the dialog title renders').toBeVisible();
  const column = title.locator('xpath=..');
  const row = title.locator('xpath=../..');

  // C6a: 20/700 on a 25px line (leading-tight), no tracking.
  const type = await title.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { lineHeight: parseFloat(cs.lineHeight), letterSpacing: cs.letterSpacing };
  });
  expect.soft(type.lineHeight, 'title line-height px (expected 25)').toBe(25);
  expect.soft(['normal', '0px'], 'title letter-spacing is normal or 0px').toContain(type.letterSpacing);

  // E8b: the header row centres the close on the whole title block, and the close is one
  // 20 x 20 stroked svg.
  const alignItems = await row.evaluate((el) => getComputedStyle(el).alignItems);
  expect.soft(alignItems === 'center', 'header row align-items is center').toBe(true);
  const close = dialog.getByRole('button', { name: 'Close' }).first();
  const closeBox = await close.boundingBox();
  const columnBox = await column.boundingBox();
  expect(closeBox, 'close button box measured').not.toBeNull();
  expect(columnBox, 'title column box measured').not.toBeNull();
  const closeMid = closeBox!.y + closeBox!.height / 2;
  const columnMid = columnBox!.y + columnBox!.height / 2;
  expect.soft(Math.abs(closeMid - columnMid), 'close vs title column vertical centre offset px (max 0.5)').toBeLessThanOrEqual(0.5);
  const icon = close.locator('svg');
  await expect.soft(icon, 'the close holds 1 svg').toHaveCount(1);
  if ((await icon.count()) === 1) {
    const iconBox = await icon.boundingBox();
    expect(iconBox, 'close icon box measured').not.toBeNull();
    expect.soft(Math.abs(iconBox!.width - 20), 'close icon width px off 20 (max 0.5)').toBeLessThanOrEqual(0.5);
    expect.soft(Math.abs(iconBox!.height - 20), 'close icon height px off 20 (max 0.5)').toBeLessThanOrEqual(0.5);
  }

  // O13a: the first body section is p-4 at phone and p-5 from md.
  const section = dialog.getByRole('heading', { level: 3, name: 'Your Friends' }).locator('xpath=..');
  const pad = await section.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v));
  });
  const expected = isMobile ? 16 : 20;
  expect.soft(pad, `first body section padding px top right bottom left (expected ${expected} each)`).toEqual([expected, expected, expected, expected]);

  await page.keyboard.press('Escape');
  await expect(dialog, 'the dialog closes on Escape').toBeHidden();
});
