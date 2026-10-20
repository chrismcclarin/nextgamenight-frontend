import { test, expect } from '@playwright/test';

import { openGroupSettings } from './support/groupSettings';

/**
 * Phase 88.6.1-20 (D-07, AC-15, W014) — the dialog focus floor, proven in a REAL browser at
 * the phone viewport. PHONE PROJECT ONLY.
 *
 * WHAT IT PROVES: AC-15's CHAINED case and the no-yank rule. Group settings' "Transfer
 * ownership instead" closes the settings dialog and opens Manage Members in ONE handler
 * (`groupHomePage/page.js`, `onOpenManageMembers`). The closing dialog's restore
 * (`restoreDialogFocus` in `src/components/ui/dialog.tsx`) must not move focus out of the
 * dialog that opened after it — so the "Group actions" trigger that opened settings never
 * receives a focus event — and closing Manage Members must land on the page's `main h1`, not
 * `<body>`. The unit suites (`Modal.test.tsx` D/D2/D3) prove the same rules in jsdom; this spec
 * exists because jsdom diverges exactly where these rules live: it runs no exit animation (so
 * a closing dialog never lingers in the DOM), never blurs a control that becomes disabled, and
 * focuses a disabled control that carries a tabindex.
 *
 * ENTRY PATH: the shared group-settings helper (`./support/groupSettings`, moved there from
 * `group-settings-danger.spec.ts` so this spec reuses it instead of copying it). The CI login
 * identity owns the seeded group, so the owner-only Danger Zone (and its transfer button)
 * renders; the count guard below asserts that instead of silently passing.
 *
 * SELECTOR POLICY: role/label/text only (invite.spec.ts:18), plus the `main h1` landmark
 * selector the floor itself targets.
 *
 * SCOPE: it opens two dialogs and presses Escape. It never confirms, deletes, transfers or
 * types a group name, so it cannot mutate the fixture group.
 *
 * CI-RUN ONLY: E2E credentials are intentionally absent locally (playwright.config.ts).
 */

type FocusCounterWindow = Window & { __dialogFloorTriggerFocusCount?: number };

test.describe('Phase 88.6.1-20 — dialog focus floor on close (phone project)', () => {
  // Same phone-only guard idiom as group-settings-danger.spec.ts: both projects match every
  // spec, and this is a phone-tenet proof measured at 375px.
  test.skip(({ isMobile }) => !isMobile, 'AC-15 phone proof — phone project only');

  test('closing Manage Members after the Settings hand-off focuses the page heading', async ({ page }) => {
    await openGroupSettings(page);

    // Vacuity guard: exactly one transfer control, or the hand-off below never happens.
    const transfer = page.getByRole('button', { name: /transfer ownership instead/i });
    await expect(
      transfer,
      'exactly one "Transfer ownership instead" button — the seeded owner must see the Danger Zone',
    ).toHaveCount(1);

    // The settings dialog's opener. Radix hides the page from the accessibility tree while a
    // modal is open, so the trigger is resolved with includeHidden.
    const trigger = page.getByRole('button', { name: /group actions/i, includeHidden: true });
    await expect(trigger, 'exactly one "Group actions" trigger').toHaveCount(1);
    await trigger.evaluate((el) => {
      const w = window as FocusCounterWindow;
      w.__dialogFloorTriggerFocusCount = 0;
      el.addEventListener('focus', () => {
        w.__dialogFloorTriggerFocusCount = (w.__dialogFloorTriggerFocusCount ?? 0) + 1;
      });
    });

    await transfer.click();
    await expect(page.getByRole('heading', { name: 'Manage Group Members' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))))
      .toBe(true);

    // The one bounded settle: wait until the settings dialog has left the DOM (its exit
    // animation is over), then one page-side setTimeout(0) round-trip. Radix dispatches the
    // closing dialog's restore from a setTimeout queued at that unmount, so after this the
    // counter read is not racing that timer. includeHidden: Radix marks everything outside the
    // newly opened dialog aria-hidden, which would read 0 while settings is still animating out.
    await expect(
      page.getByRole('heading', { name: /customize group/i, includeHidden: true }),
    ).toHaveCount(0);
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const triggerFocusCount = await page.evaluate(
      () => (window as FocusCounterWindow).__dialogFloorTriggerFocusCount,
    );
    expect(
      triggerFocusCount,
      'the closing settings dialog must not focus its opener while Manage Members holds focus',
    ).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Manage Group Members' })).toHaveCount(0);
    await expect(page.locator('main h1'), 'the group page renders exactly one main h1').toHaveCount(1);
    await expect(page.locator('main h1')).toBeFocused();
  });
});
