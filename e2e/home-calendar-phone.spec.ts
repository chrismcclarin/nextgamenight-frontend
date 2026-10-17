import { test, expect } from '@playwright/test';

// Phase 88.6.1-73 (RF1 / D-47, plan 88.6.1-70 contract C8 d) — a TRIPWIRE, confirm-only.
//
// WHY THIS IS NOT AN RF1 MEASUREMENT. Plan 70's contract asks every RF1 consumer for a phone e2e
// that measures the notice in place at 375px. The home page's EventCalendar has no phone surface
// to measure: its column is CSS-hidden below the md breakpoint (UserHomePage.js, the
// `hidden md:flex` column that holds `<EventCalendar refreshKey={refreshKey} />`), and the group
// page's calendar is handed its events and never fetches, so it never shows the notice. The
// calendar still MOUNTS at every width (the hide is CSS only), so its title heading is attached
// on a phone too.
//
// WHAT IT PINS. At phone width the home calendar is attached but not displayed, and the page does
// not scroll sideways; at 768px or wider it is visible. If this test ever fails at 375px, the
// calendar has reached phones, and RF1 must then be measured there in place (contract C8 d).
//
// READ-ONLY: the spec intercepts nothing, clicks nothing and writes nothing. A missing heading
// fails, never skips.
//
// CI-RUN ONLY: both projects need the .auth/user.json login state, which exists only in CI
// (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.

test.describe('Home calendar visibility by width (plan 88.6.1-73 tripwire)', () => {
  test('the home calendar is hidden below md and shown at md and wider (RF1 has no phone surface here)', async ({ page }, testInfo) => {
    await page.goto('/');

    const heading = page.getByRole('heading', {
      name: 'Game Sessions Calendar',
      exact: true,
      includeHidden: true,
    });
    // It mounts at every width; the heading arrives once the calendar has loaded (or failed).
    await expect(heading).toBeAttached({ timeout: 15_000 });

    const width = page.viewportSize()?.width;
    expect(width, 'the project sets a viewport').toBeDefined();
    if (testInfo.project.name === 'phone') {
      // The measurement is provably at phone width.
      expect(width).toBe(375);
    }

    if ((width as number) < 768) {
      await expect(heading).toBeHidden();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, 'the page must not scroll sideways').toBeLessThanOrEqual(clientWidth);
    } else {
      await expect(heading).toBeVisible();
    }
  });
});
