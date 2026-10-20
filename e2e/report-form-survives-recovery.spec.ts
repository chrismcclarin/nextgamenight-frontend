import { test, expect } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

// Phase 88.6.1 plan 69, Task 3: the report form outlives the banner that opened it, proven on a
// phone (375 x 667).
//
// WHAT THIS PROVES, in a real browser at 375px, on /userProfile's schedules banner (caller-gated,
// never-loaded: the page removes the banner at the press and when the data loads):
//   - the owner's 2026-10-05 ruling: no Report this at the first failure; a failed Try again
//     brings it;
//   - the report form opens inside the phone viewport with no horizontal overflow;
//   - a recovery while the person is typing (the error hook's tab-return re-attempt) removes the
//     banner and the form STAYS open with every typed character (the bug this task fixes: the form
//     used to live inside the banner and died with it);
//   - closing the form lands focus on the Schedules panel's own heading (the banner's
//     focusTarget, handed to the report form as its fallback: DECISION Phase 88.6.1-59 (AC-29 /
//     RF1, D-05) and DECISION Phase 88.6.1-70 (Req 5, focusTarget)), never on <body>.
//
// NOT RUN LOCALLY. The `phone` project needs the CI-only Auth0 login (`.auth/user.json`; C-14 in
// .planning/codebase/FE-TESTING-CONVENTIONS.md). Typecheck and collection are the local proof; the
// CI e2e job is the proof.
//
// NO WRITES. Every write is held in the browser by the shared backstop (holdWrites), registered
// before the first navigation, and the afterEach fails the test if an /api write reached it. Only
// the schedules GET is answered here (a forced 500, then an empty list). The form is never
// submitted.

// The schedules list on /userProfile (src/lib/api.ts, `/availability/user/<id>/patterns`).
const PATTERNS_GET = /\/availability\/user\/[^/]+\/patterns/;
const DIALOG_NAME = 'Report Bug or Suggest Feature';
const BANNER_TITLE = "Couldn't load your schedules";
const TYPED = ' It broke after the update.';

test.describe('a typed report survives a recovery on a phone (88.6.1-69, Req 11)', () => {
  // Phone first: `journeys` collects this spec too; this is the 375px proof.
  test.skip(({ isMobile }) => !isMobile, 'the phone proof of the report form surviving a recovery');

  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('the report form and its typed text stay open when the schedules recover underneath', async ({ page }) => {
    backstop = await holdWrites(page);
    let mode: 'fail' | 'pass' = 'fail';
    await page.route(PATTERNS_GET, async (route) => {
      if (route.request().method() !== 'GET') {
        // Down to the backstop, which holds it.
        await route.fallback();
        return;
      }
      if (mode === 'fail') {
        await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
        return;
      }
      await route.fulfill({ status: 200, json: [] });
    });

    await page.goto('/userProfile');

    // A missing banner is a failure, never a skip.
    const tryAgain = page.getByRole('button', { name: 'Try again' });
    await expect(tryAgain).toHaveCount(1, { timeout: 15_000 });
    const report = page.getByRole('button', { name: 'Report this' });
    await expect(report).toHaveCount(0);

    // A failed retry (still 'fail') brings the link to the re-inserted banner.
    await tryAgain.click();
    await expect(report).toHaveCount(1, { timeout: 15_000 });
    await report.click();

    const dialog = page.getByRole('dialog', { name: DIALOG_NAME });
    await expect(dialog).toBeVisible();
    await settleAnimations(dialog);
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project sets a viewport').not.toBeNull();
    const box = await dialog.boundingBox();
    expect(box, 'the dialog renders a box').not.toBeNull();
    if (box && viewport) {
      expect(box.x, 'the dialog starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'the dialog ends inside the viewport').toBeLessThanOrEqual(viewport.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'no horizontal overflow at 375px',
    ).toBe(true);

    // Type at the END of the prefilled description.
    const description = dialog.getByRole('textbox', { name: /Description/ });
    const prefill = await description.inputValue();
    await description.focus();
    await description.evaluate((el) => {
      const field = el as HTMLTextAreaElement;
      field.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.type(TYPED);
    await expect(description).toHaveValue(prefill + TYPED);

    // The data recovers through the error hook's tab-return re-attempt (the page is visible, so
    // its listener re-fetches), and the caller removes the banner.
    mode = 'pass';
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText(BANNER_TITLE)).toHaveCount(0, { timeout: 15_000 });

    // The form is still open, with every typed character.
    await expect(dialog).toBeVisible();
    await expect(description).toHaveValue(prefill + TYPED);

    // Closing it: the opener is gone, so the banner's focusTarget (the panel's own heading; plan
    // 59 wired it after this spec was written, superseding its `main h1` expectation: wave 7 CI
    // gate, run 39020174955).
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 3, name: 'Availability Schedules' }),
    ).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body), 'never <body>').toBe(false);
  });
});
