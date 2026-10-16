import { test, expect, type Page } from '@playwright/test';

import { focusByKeyboard } from './support/contrast';
import { openGroupSettings } from './support/groupSettings';
import { expectGatedPair, holdWrites, type WriteHold } from './support/inFlight';

// Phase 88.6.1-43: the Group settings dialog's in-flight controls and its default-icon radio
// group, seen in a real browser at 375px (the phone project, iPhone SE 375x667, dark).
//
// WHAT THIS PROVES THAT JSDOM CANNOT. jsdom never blurs a disabled element (C-11 in
// .planning/codebase/FE-TESTING-CONVENTIONS.md), so GroupSettings.test.tsx (PC1-PC7) pins the
// attributes and the request counts but cannot prove focus or paint. Here, in Chromium:
//   1. the typed delete field keeps focus after Enter, read-only and aria-disabled, and a second
//      Enter sends no second DELETE (D-26, the arm plan 88.6.1-22 handed over);
//   2. the focused Delete confirm keeps focus after Enter, aria-disabled with no disabled
//      attribute, painting the gated danger pair at opacity 1 (R123 / AC-9, handed over);
//   3. Save Changes keeps focus while saving and paints the gated primary pair (W016 row 18);
//   4. on the owner's answer 3A (the confirm dialog's Cancel stays live while pending), a
//      mid-flight Cancel lands focus on the Delete Group opener, which is aria-disabled and
//      opens no second dialog (W016 row 19, W014 case 1);
//   5. the eight default icons are ONE tab stop that the arrow keys drive (D-20 / D-43), every
//      tile named by its kept title, and no tile under 44px tall (D-21).
//
// WHY IT IS SAFE TO PRESS DELETE AND SAVE HERE. holdWrites (e2e/support/inFlight.ts) is
// registered in beforeEach BEFORE openGroupSettings navigates. Every request that is not a GET
// or HEAD is held in the browser and never answered — nothing is handed on — and each write
// test asserts the hold caught exactly ONE DELETE or PUT, which proves the hold saw it. CI's
// database is an ephemeral postgres:16 service per run: defence in depth, never relied on.
//
// DECISION Phase 88.6.1-43 (D-26 / R123 real-browser arm, handed over by 88.6.1-22): a NEW spec
// that types the confirm phrase ONLY behind a hold registered before navigation, so no write can
// leave the browser. Rejected: extending e2e/group-settings-danger.spec.ts — its own docblock
// forbids typing the group name there ("Do NOT \"extend\" it to exercise the delete"), and it
// holds nothing. Changing this is a decision, not a cleanup.
//
// PHONE ONLY, and CI ONLY like every spec here (C-14): the phone project needs the setup
// project's login, whose credentials exist only in CI. Typecheck and listing are the local
// proof; the CI e2e job is the proof. Selectors are role, label and text only.

const DELETE_PATH = /\/groups\/[^/]+$/;
const SETTINGS_PATH = /\/groups\/[^/]+\/settings$/;
const DELETE_DIALOG = /^Delete .+\?$/;
// The shipped names of the eight default icons, in reading order (GroupSettings.js,
// DEFAULT_PROFILE_PICTURES).
const ICON_NAMES = ['Dice', 'Cards', 'Trophy', 'Game', 'Puzzle', 'Star', 'Fire', 'Rocket'];

test.describe('Group settings — pressed controls keep focus and send one write; the icon picker is one radio group (88.6.1-43)', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    '88.6.1-43: pending focus and the radio group are phone-forward checks (375x667), so this spec runs only in the phone project',
  );

  let hold: WriteHold;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST: openGroupSettings navigates.
    hold = await holdWrites(page);
    await openGroupSettings(page);
  });

  // Opens the delete confirm from the Danger Zone by keyboard and types its phrase (read from the
  // field's placeholder, which is the expected phrase). Returns the dialog.
  async function openDeleteConfirmAndType(page: Page) {
    const opener = page.getByRole('button', { name: 'Delete Group', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: DELETE_DIALOG });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const input = dialog.getByRole('textbox');
    await expect(input).toBeFocused();
    const phrase = await input.getAttribute('placeholder');
    expect(phrase, 'the typed field carries its expected phrase as the placeholder').toBeTruthy();
    await input.fill(phrase as string);
    return { dialog, input };
  }

  test('typed field, Enter path: the field keeps focus, read-only and aria-disabled, and a second Enter sends nothing (D-26)', async ({ page }) => {
    const { dialog, input } = await openDeleteConfirmAndType(page);

    await page.keyboard.press('Enter');
    // A missing request is a failure, never a skip.
    await expect.poll(() => hold.count('DELETE', DELETE_PATH), { timeout: 15_000 }).toBe(1);

    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('readonly');
    await expect(input).toHaveAttribute('aria-disabled', 'true');
    const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await expect(confirm).not.toHaveAttribute('disabled');

    await page.keyboard.press('Enter');
    // An ABSENCE check: there is no positive signal to wait for, so wait a fixed 500ms.
    await page.waitForTimeout(500);
    expect(hold.count('DELETE', DELETE_PATH)).toBe(1);
    await expect(input).toHaveAttribute('aria-disabled', 'true');
  });

  test('Delete confirm, button path: it keeps focus, aria-disabled, painting the gated danger pair, and a second Enter sends nothing (R123 / AC-9)', async ({ page }) => {
    const { dialog } = await openDeleteConfirmAndType(page);
    const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => hold.count('DELETE', DELETE_PATH), { timeout: 15_000 }).toBe(1);

    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await expect(confirm).not.toHaveAttribute('disabled');
    await expectGatedPair(page, confirm, 'danger', 'dark');

    await page.keyboard.press('Enter');
    // An ABSENCE check: there is no positive signal to wait for, so wait a fixed 500ms.
    await page.waitForTimeout(500);
    expect(hold.count('DELETE', DELETE_PATH)).toBe(1);
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(overflow.innerWidth);
  });

  test('Save Changes keeps focus while saving, paints the gated primary pair, and a second Enter sends nothing (W016 row 18)', async ({ page }) => {
    const save = page.getByRole('button', { name: 'Save Changes', exact: true });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => hold.count('PUT', SETTINGS_PATH), { timeout: 15_000 }).toBe(1);

    const saving = page.getByRole('button', { name: 'Saving...', exact: true });
    await expect(saving).toBeFocused();
    await expect(saving).toHaveAttribute('aria-disabled', 'true');
    await expect(saving).not.toHaveAttribute('disabled');
    await expectGatedPair(page, saving, 'primary', 'dark');

    await page.keyboard.press('Enter');
    // An ABSENCE check: there is no positive signal to wait for, so wait a fixed 500ms.
    await page.waitForTimeout(500);
    expect(hold.count('PUT', SETTINGS_PATH)).toBe(1);
    await expect(saving).toHaveAttribute('aria-disabled', 'true');
  });

  test('answer 3A: Cancel while the delete is pending lands focus on the aria-disabled Delete Group opener, which opens no second dialog (W016 row 19, W014 case 1)', async ({ page }) => {
    // Written for the owner's answer 3A to plan 88.6.1-22 (2026-10-16): the confirm dialog's
    // Cancel, header close, Escape and overlay stay live while a confirm is pending.
    const { dialog } = await openDeleteConfirmAndType(page);
    const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => hold.count('DELETE', DELETE_PATH), { timeout: 15_000 }).toBe(1);

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: DELETE_DIALOG })).toHaveCount(0);

    const opener = page.getByRole('button', { name: 'Deleting...', exact: true });
    await expect(opener).toBeFocused();
    await expect(opener).toHaveAttribute('aria-disabled', 'true');
    await expect(opener).not.toHaveAttribute('disabled');

    await page.keyboard.press('Enter');
    // An ABSENCE check: there is no positive signal to wait for, so wait a fixed 500ms.
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog', { name: DELETE_DIALOG })).toHaveCount(0);
    expect(hold.count('DELETE', DELETE_PATH)).toBe(1);
  });

  test('the default icons are one radio group: one tab stop, arrows move AND check, every tile named by its title and at least 44px tall (D-20 / D-43, D-21)', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Choose a default icon:' });
    await expect(group).toBeVisible();
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(ICON_NAMES.length);

    for (const [index, name] of ICON_NAMES.entries()) {
      const tile = group.getByRole('radio', { name, exact: true });
      // Playwright's role engine takes the name from the kept title (the emoji is aria-hidden);
      // this is not Chromium's own accessibility tree and not VoiceOver.
      await expect(radios.nth(index)).toHaveAccessibleName(name);
      await expect(tile).toHaveAttribute('title', name);
    }

    const stops = group.locator('[role="radio"][tabindex="0"]');
    await expect(stops).toHaveCount(1);
    const startName = await stops.getAttribute('title');
    const start = ICON_NAMES.indexOf(startName as string);
    expect(start, `the tab stop is one of the eight named tiles (got ${startName})`).toBeGreaterThanOrEqual(0);
    const startTile = group.getByRole('radio', { name: ICON_NAMES[start], exact: true });
    await focusByKeyboard(page, startTile);
    await expect(startTile).toBeFocused();

    // ArrowRight moves to the next tile and checks it (from the 8th it wraps to the 1st).
    const nextName = ICON_NAMES[(start + 1) % ICON_NAMES.length];
    const nextTile = group.getByRole('radio', { name: nextName, exact: true });
    await page.keyboard.press('ArrowRight');
    await expect(nextTile).toBeFocused();
    await expect(nextTile).toHaveAttribute('aria-checked', 'true');
    await expect(startTile).toHaveAttribute('aria-checked', 'false');
    await expect(group.locator('[role="radio"][aria-checked="true"]')).toHaveCount(1);

    // One stop: Tab leaves the group for the custom URL field, Shift+Tab comes back to the
    // checked tile.
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Or enter a custom image URL:')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(nextTile).toBeFocused();

    // D-21: the tile needs no floor change; every box is at least 44px tall at 375px. Polled,
    // because the dialog zooms in on open.
    for (let index = 0; index < ICON_NAMES.length; index += 1) {
      await expect
        .poll(async () => (await radios.nth(index).boundingBox())?.height ?? 0, {
          message: `tile ${ICON_NAMES[index]} is at least 44px tall`,
        })
        .toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(overflow.innerWidth);
    // Nothing was saved (checking only sets form state); the hold would have caught a write
    // anyway. Counted by method and path, not by the whole hold: an unrelated beacon (an error
    // report, telemetry) is a non-GET too and is held without being a settings write.
    expect(hold.count('PUT', SETTINGS_PATH)).toBe(0);
  });
});
