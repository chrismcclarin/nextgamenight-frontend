import { test, expect } from '@playwright/test';

import { assertTheme, forceLightMode } from './support/contrast';
import { expectFocusRingClearOfText } from './support/ringGeometry';

// Phase 88.6.1 plan 53 (AC-23 / V-1a): the Edit-username pencil's focus ring must not paint over
// the last letter of the username. The owner saw it on 2026-09-30 ("the tabbed border covers the
// last letter of the name"): the pencil's -m-2 box starts on the heading's right edge, and the
// house outset ring (2px offset plus 2px width) painted 4px outside that box. The fix is an inset
// ring (`DECISION Phase 88.6.1-53 (V-1a / AC-23)` in src/app/userProfile/page.js). Against the old
// outset ring this spec fails with the helper naming the 4px outward extent.
//
// BOTH PROJECTS ON PURPOSE: the geometry is width-independent, and the phone (375 x 667) is the
// primary surface, so it runs in `phone` and in `journeys` (desktop). Dark is the projects'
// pinned scheme; light is forced before navigation and both are asserted before any read.
//
// WRITES NOTHING AND INTERCEPTS NOTHING: it loads the page, focuses one button by keyboard and
// reads computed geometry. No click, no form input.
//
// NOT RUN LOCALLY (no .auth fixture, C-14): typecheck and listing are the local proof; the CI
// e2e job is the proof.

test.describe('Profile Edit-username pencil focus ring (plan 88.6.1-53, AC-23)', () => {
  test('pencil focus ring does not cover the username (dark)', async ({ page }) => {
    await page.goto('/userProfile');
    await assertTheme(page, 'dark');

    // A missing control is a failure, never a skip.
    const pencil = page.getByRole('button', { name: 'Edit username' });
    await expect(pencil).toBeVisible({ timeout: 15_000 });
    const name = pencil.locator('xpath=preceding-sibling::h1[1]');
    await expect(name).toBeVisible();

    await expectFocusRingClearOfText(page, pencil, name, 'Edit-username pencil (dark)');
  });

  test('pencil focus ring does not cover the username (light)', async ({ page }) => {
    await forceLightMode(page);
    await page.goto('/userProfile');
    await assertTheme(page, 'light');

    const pencil = page.getByRole('button', { name: 'Edit username' });
    await expect(pencil).toBeVisible({ timeout: 15_000 });
    const name = pencil.locator('xpath=preceding-sibling::h1[1]');
    await expect(name).toBeVisible();

    await expectFocusRingClearOfText(page, pencil, name, 'Edit-username pencil (light)');
  });
});
