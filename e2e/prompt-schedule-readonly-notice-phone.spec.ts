import { test, expect } from '@playwright/test';

import { E2E_GROUP_ID, openGroupSettings, openGroupSettingsFromKebab } from './support/groupSettings';
import {
  expectNoApiWrites,
  holdRequests,
  holdWrites,
  settleAnimations,
  type WriteHold,
} from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';

// Phase 88.6.2-22 (R8, register row 80: the open dialog never refetches on its own) — the
// read-only check-ins summary inside Customize Group (PromptScheduleReadOnly) at 375px, in a
// real browser (the phone project).
//
// WHAT IT PROVES: after the summary loaded once, a refresh that fails keeps the loaded schedule
// and its count, the RF1 notice row sits above them, and its Retry clears 44 x 44 inside the
// viewport with no sideways scroll. While the refresh is in flight no notice shows. It closes the
// gap recorded at e2e/recurring-checkins-phone.spec.ts ("HONEST GAP: the read-only summary inside Customize Group").
//
// IT NEVER WRITES TO THE BACKEND. The shared write hold (holdWrites in e2e/support/inFlight.ts)
// is registered FIRST, so it runs LAST: every write is held in the browser and never sent, and
// the afterEach fails the test naming any /api write it caught. The settings read is answered in
// the browser (answerGet), and its refetch is held, then failed, in the browser (holdRequests).
// No write control is pressed.
//
// DECISION Phase 88.6.2-22 (stale-reopen): the page clock moves past
// src/lib/queryClient.ts ("staleTime: 30_000, // D-13"), then a reopen without navigation
// (openGroupSettingsFromKebab) remounts the summary on stale cached data, so it refetches.
// Chosen over three alternatives: a real 31 s wait (past the 30 s default test timeout); a
// reload, which drops the query cache so the retained state never forms; and exposing the query
// client to the page, a production change (R11). The open dialog alone never refetches: the
// query sets no refetch option of its own and inherits
// src/lib/queryClient.ts ("refetchOnWindowFocus: false,"), and the summary mounts only while
// the dialog is open, src/app/groupHomePage/page.js ("{showGroupSettings && Group && ("), so a
// close and reopen is the one in-page way to a fresh mount. Changing this is a decision, not a
// cleanup.
//
// CI ONLY: the phone project needs the .auth storage state and the E2E login secrets, which
// exist only in CI (FE-TESTING-CONVENTIONS C-14). Locators are role, name and text only.

const SETTINGS_PATH = `/api/groups/${E2E_GROUP_ID}/prompt-settings`;
const SCHEDULE_NAME = 'E2E summary check-in';
// Passes promptSettingsSchema (src/lib/schemas/prompts.ts), so it never soft-fails to empty.
const SETTINGS_BODY = {
  id: '00000000-0000-4000-8000-0000000000d0',
  schedules: [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      name: SCHEDULE_NAME,
      template_name: SCHEDULE_NAME,
      is_active: true,
    },
  ],
  games: [],
  members: [],
};
const FAILURE_BODY = { error: 'E2E: the summary refresh fails on purpose' };
// Copy row RF1 (REFRESH_FAILED_NOTICE in FetchErrorBanner.tsx), straight apostrophe.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
// Past the 30 s staleTime.
const PAST_STALE = '00:31';

test.describe('Customize Group check-ins summary at 375px (88.6.2-22)', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    '88.6.2-22: the summary notice layout is a phone-forward check (375x667, SPEC constraint), so this spec runs only in the phone project',
  );

  let hold: WriteHold;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any other route and before navigation, so it is the last resort.
    hold = await holdWrites(page, {
      answerGet: (url) => (url.pathname === SETTINGS_PATH ? SETTINGS_BODY : undefined),
    });
  });

  test.afterEach(() => expectNoApiWrites(hold));

  test('a failed refresh keeps the loaded schedule under the notice inside Customize Group', async ({ page }) => {
    // Installed before the page loads; time still runs normally until it is moved below.
    await page.clock.install();
    await openGroupSettings(page);

    const dlg = page.getByRole('dialog', { name: 'Customize Group', exact: true });
    const heading = dlg.getByRole('heading', { level: 3, name: 'Recurring Check-ins (1)', exact: true });
    await expect(
      heading,
      'the summary heading never read Recurring Check-ins (1) — the settings read is answered with one active schedule in the browser (answerGet)',
    ).toBeVisible({ timeout: 15_000 });
    const summary = heading.locator('xpath=..');
    const schedule = summary.getByText(SCHEDULE_NAME, { exact: true });
    await expect(schedule, 'the loaded schedule is not listed in the summary').toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dlg, 'Escape did not close Customize Group').toHaveCount(0);

    await page.clock.fastForward(PAST_STALE);
    const refetch = await holdRequests(page, {
      method: 'GET',
      match: (url) => url.pathname === SETTINGS_PATH,
    });

    await openGroupSettingsFromKebab(page);
    await expect
      .poll(() => refetch.count(), {
        message:
          'the reopen did not refetch the settings: the staleTime premise or the page clock did not hold',
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    // IN FLIGHT: the cached rows show and no notice does.
    await expect(heading, 'the heading and its count must show from the cache while the refresh is in flight').toBeVisible();
    await expect(schedule, 'the cached schedule must show while the refresh is in flight').toBeVisible();
    await expect(
      summary.getByRole('button', { name: 'Retry', exact: true }),
      'a Retry showed before the refresh failed',
    ).toHaveCount(0);

    await refetch.release(SETTINGS_BODY, 200); // zz-plant-88.6.2-29 M-22b

    const retry = summary.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry, 'the failed refresh never showed the notice Retry').toBeVisible({ timeout: 10_000 });
    const noticeRow = retry.locator('..');
    await expect(noticeRow, 'the notice row does not read the RF1 sentence').toContainText(RF1);
    await expect(
      summary.getByText("We couldn't load your schedules"),
      'the first-load failure banner showed although the schedule had loaded',
    ).toHaveCount(0);
    await expect(heading, 'the heading lost its count after the failed refresh').toBeVisible();
    await expect(schedule, 'the loaded schedule was dropped after the failed refresh').toBeVisible();

    await retry.scrollIntoViewIfNeeded();
    await settleAnimations(dlg);
    await expectTouchTarget(retry, 'the summary notice Retry', { withinViewportOf: page });

    const rowBox = await noticeRow.boundingBox();
    const scheduleBox = await schedule.boundingBox();
    expect(rowBox, 'the notice row has no bounding box').not.toBeNull();
    expect(scheduleBox, 'the schedule has no bounding box').not.toBeNull();
    if (!rowBox || !scheduleBox) return;
    expect(
      rowBox.y + rowBox.height,
      `the notice row must sit above what loaded earlier (row bottom ${rowBox.y + rowBox.height}px, schedule top ${scheduleBox.y}px)`,
    ).toBeLessThanOrEqual(scheduleBox.y);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `the page scrolls sideways with the notice showing (scrollWidth ${scrollWidth}px, clientWidth ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth);
  });
});
