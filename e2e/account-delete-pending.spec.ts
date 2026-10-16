import { test, expect } from '@playwright/test';

import { expectGatedPair, holdWrites } from './support/inFlight';

// Phase 88.6.1 plan 22 (D-39, D-35; outline shared rule 9): the account-deletion dialog's
// pressed "Delete my account" action, seen in a real browser at 375px.
//
// WHAT THIS PROVES THAT JSDOM CANNOT. jsdom never blurs a disabled element (C-11 in
// .planning/codebase/FE-TESTING-CONVENTIONS.md), so the unit suite
// (src/app/components/DangerZoneDeleteAccount.test.tsx, DZ1-DZ9) pins the attributes and the
// request counts but cannot prove focus or paint. Here, in Chromium at the phone width:
//   - the pressed action stays in the document, aria-disabled, with no disabled attribute;
//   - it paints the gated danger pair (the .btn-danger aria-disabled rule in globals.css, the
//     same rule ConfirmDialog's pending confirm uses): computed colours equal the
//     --color-btn-danger-gated-* tokens, opacity 1 — not the 50% wash;
//   - focus lands on the progress wrapper itself (D52 piece (ii)), checked by IDENTITY, and
//     never on <body>;
//   - the header Close says it is unavailable;
//   - a second Enter on the action sends no second DELETE (the deleteInFlightRef latch);
//   - nothing overflows horizontally.
//
// WHY IT IS SAFE TO DRIVE ACCOUNT DELETION HERE. The CI login identity is a real account, and
// this test types the confirm phrase into the live gate. One catch-all handler is registered
// BEFORE navigation: GET and HEAD go on to the network untouched (route.fallback), except the
// deletion pre-flight GET, which is answered in the browser with { groups: [] } (a read; it
// only keeps the action on screen whatever the fixture account owns). EVERY other request —
// the DELETE included — is pushed onto an array and never answered: no fulfil, no abort, and
// nothing handed on. heldDeletes() asserts the hold caught exactly one DELETE. Defence in depth,
// not relied on: CI's database is an ephemeral postgres:16 service per run (ci.yml, job e2e).
//
// Phase 88.6.1-43: the hold and the gated-colour probe now live ONCE in e2e/support/inFlight.ts
// (holdWrites, expectGatedPair), shared with e2e/group-settings-pending-focus.spec.ts. Same
// behaviour as the inline copies they replace: the one answered read is the deletion pre-flight,
// through holdWrites' answerGet; heldDeletes stays local, built on the hold's count.
//
// PHONE ONLY, and CI ONLY like every spec here: the phone project needs the setup project's
// Auth0 login, whose credentials exist only in CI (C-14). Typecheck and listing are the local
// proof; the CI e2e job is the proof.
test.skip(
  ({ isMobile }) => !isMobile,
  "88.6.1-22 D-39: the gated danger colour and the pressed action are a phone-forward check (375x667), so this spec runs only in the phone project",
);

test.describe('Account deletion — the pressed danger action stays focusable at 375px (88.6.1-22)', () => {
  test('pressed "Delete my account" keeps the gated colour, focus moves to the progress wrapper, the header Close is unavailable, a second Enter sends nothing', async ({ page }) => {
    // Registered BEFORE navigation. Held: never answered, never handed on. This is what makes
    // the test safe.
    const hold = await holdWrites(page, {
      answerGet: (url) =>
        url.pathname.endsWith('/users/me/deletion-blockers') ? { groups: [] } : undefined,
    });
    const heldDeletes = (): number => hold.count('DELETE', /\/users\/me$/);

    await page.goto('/userProfile');

    // exact: the trigger is "Delete My Account"; the action inside the dialog is
    // "Delete my account".
    const opener = page.getByRole('button', { name: 'Delete My Account', exact: true });
    await opener.scrollIntoViewIfNeeded();
    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'Delete your account' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const input = dialog.getByPlaceholder('delete my account');
    // The pre-flight settled: the input is enabled only after it does.
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.fill('delete my account');

    await dialog.getByRole('button', { name: 'Delete my account', exact: true }).focus();
    await page.keyboard.press('Enter');
    // A missing control or request is a failure, never a skip.
    await expect.poll(heldDeletes, { timeout: 15_000 }).toBe(1);

    const pressed = dialog.getByRole('button', { name: 'Deleting…', exact: true });
    await expect(pressed).toBeAttached();
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');

    // Theme pre-assertion, the transition settle and the token probe comparison, in one shared
    // helper (opacity 1, computed colours equal --color-btn-danger-gated-bg / -text).
    await expectGatedPair(page, pressed, 'danger', 'dark');

    // Focus is on the progress wrapper ITSELF, checked by identity. A text check cannot do this
    // job: the pressed action reads the same in-flight label and, being aria-disabled, keeps
    // focus, so it would pass with the D52 (ii) focus move deleted (then focus stays on BUTTON).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            return {
              onBody: element === document.body,
              tag: element?.tagName ?? null,
              tabindex: element?.getAttribute('tabindex') ?? null,
              holdsStatusRegion: element?.querySelector('[role="status"]') != null,
            };
          }),
        { timeout: 5_000 },
      )
      .toEqual({ onBody: false, tag: 'DIV', tabindex: '-1', holdsStatusRegion: true });

    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(overflow.innerWidth);

    // The latch in a real browser: a second Enter on the still-focusable action sends nothing.
    await pressed.focus();
    await page.keyboard.press('Enter');
    // An ABSENCE check: there is no positive signal to wait for, so wait a fixed 500ms.
    await page.waitForTimeout(500);
    expect(heldDeletes()).toBe(1);
  });
});
