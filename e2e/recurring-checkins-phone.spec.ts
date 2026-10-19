import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

// Phase 88.6.1 plan 30 — Recurring Check-ins and Start a check-in at 375px, in a real browser.
//
// WHAT IT PROVES (what jsdom cannot):
//   E1 (Req 5, D-04): Cancel on a schedule's inline delete confirm, opened from the phone
//      `Schedule actions` menu, hands focus back to that menu's trigger — never to the page body.
//   E2 (Req 5 + AC-29 / RF1, plan 70 contract C8 d): Confirm Delete lands focus on the section's
//      `Recurring Check-ins` heading; the refresh that follows fails, the schedule that loaded
//      earlier stays under the RF1 notice (its Retry at least 44 x 44, inside the viewport, no
//      sideways scroll, the notice above the list); a keyboard Retry that succeeds lands on the
//      heading again. A failed layout assertion here is a STOP for the owner's mockup (plan 70
//      C8 d) — report the measured numbers, never restyle the notice from this spec.
//   E3 (D-35, D-24, Req 8): the pressed `Start poll` keeps focus while it works, reads
//      `Starting...` with aria-disabled and no native disabling attribute, is at least 44px tall,
//      and a proxy CSRF 403 then announces copy row R1 in the dialog's one alert.
//
// IT NEVER WRITES TO THE BACKEND. The settings GET, the schedule DELETE and the check-in POST are
// fulfilled with `page.route` on their BROWSER paths (`apiFetch` prefixes every endpoint with
// `/api`: `src/lib/api.ts`, anchors `const BFF_BASE = '/api';` and `${BFF_BASE}${endpoint}`), so
// CI never deletes the fixture's data or opens a check-in on the shared group. Behind them sits
// the shared write hold (`e2e/support/inFlight.ts`, `holdWrites`), registered FIRST so it runs
// LAST (Playwright runs the newest matching handler first; `route.fallback()` hands on to older
// ones): any other write is held in the browser, never sent, and the afterEach fails the test
// naming every `/api` write it caught. A mock that declines a request uses `route.fallback()`,
// never `route.continue()`, so the hold still sees it. If CI shows a write the page makes on its
// own, mock that exact path; never widen the hold into an allow.
//
// DECISION Phase 88.6.1-30 (the write backstop): the shared `holdWrites` over an inline abort
// route of this spec's own — plan 88.6.1-43's one-helper tenet (`DECISION Phase 88.6.1-43
// (tenet: one helper)` in inFlight.ts: two copies of a safety hold drift, and the copy that
// drifts is the one that lets a write through). Same safety property: the write never leaves
// the browser, and the test fails naming it. Changing this is a decision, not a cleanup.
//
// WHY KEYBOARD ACTIVATION (focus, then Enter): that is the keyboard and screen-reader path this
// plan fixes, and the one `toBeFocused()` reads deterministically. The pointer path is covered
// too — Confirm Delete and Cancel arm their focus recovery with the pressed button itself, so a
// Safari tap that leaves focus on the page body is recovered — but that shape is pinned in jsdom
// (PromptScheduleManager.test.tsx, T6): this `phone` project is Chromium, which focuses a tapped
// button, so a tap here would not reproduce it.
//
// HONEST GAP: the read-only summary inside Customize Group (PromptScheduleReadOnly) is NOT
// driven here — inside the open dialog its settings query never refetches on its own
// (`staleTime: 30_000`, `refetchOnWindowFocus: false`), so reaching a retained failure there
// needs a fake clock or a dialog re-open helper that keeps the query cache; its notice is the
// same shared row E2 measures, and its structure is pinned in PromptScheduleReadOnly.test.tsx.
//
// CI ONLY: the `phone` project needs `.auth/user.json` and the E2E login secrets, which exist only
// in CI (FE-TESTING-CONVENTIONS C-14). Locators are role, name and text only.

// Seeded fixture group, same obviously-fake fallback idiom as padding-budget.spec.ts.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
// Copy row R1 (D-32 R1), straight apostrophe.
const R1 = "We couldn't start that check-in. Please try again.";

const SETTINGS_PATH = `/api/groups/${E2E_GROUP_ID}/prompt-settings`;
const SCHEDULE = {
  id: '00000000-0000-4000-8000-0000000000c1',
  template_name: 'E2E Thursday check-in',
  schedule_day_of_week: 4,
  schedule_time: '18:00',
  schedule_timezone: 'America/New_York',
  is_active: true,
};
const SCHEDULE_PATH = `${SETTINGS_PATH}/schedules/${SCHEDULE.id}`;
// Both bodies pass `promptSettingsSchema` (src/lib/schemas/prompts.ts), so neither soft-fails to
// empty for the wrong reason.
const SETTINGS_BODY = { id: '00000000-0000-4000-8000-0000000000c0', schedules: [SCHEDULE], games: [], members: [] };
const EMPTY_SETTINGS_BODY = { id: null, schedules: [], games: [], members: [] };
// The proxy's own CSRF refusal body (src/app/api/[...path]/route.ts, anchor `csrf_rejected: true`).
const CSRF_BODY = { error: 'Cross-origin request rejected', csrf_rejected: true };

type SettingsMode = 'fixture' | 'failing' | 'empty';

async function mockSettings(page: Page, mode: { current: SettingsMode }) {
  await page.route(
    (url) => url.pathname === SETTINGS_PATH,
    async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (mode.current === 'failing') {
        await route.fulfill({ status: 500, json: { error: 'E2E refresh failure' } });
        return;
      }
      await route.fulfill({
        status: 200,
        json: mode.current === 'empty' ? EMPTY_SETTINGS_BODY : SETTINGS_BODY,
      });
    },
  );
}

async function activate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Enter');
}

const sectionHeading = (page: Page) =>
  page.getByRole('heading', { level: 3, name: 'Recurring Check-ins', exact: true });
const scheduleActions = (page: Page) =>
  page.getByRole('button', { name: 'Schedule actions', exact: true });

// Opens the phone menu by keyboard and returns the list its trigger names through aria-controls.
async function openScheduleMenu(page: Page) {
  const trigger = scheduleActions(page);
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await activate(page, trigger);
  await expect(trigger).toHaveAttribute('aria-controls', /.+/);
  const listId = await trigger.getAttribute('aria-controls');
  return { trigger, list: page.locator(`[id="${listId}"]`) };
}

test.describe('Recurring Check-ins and Start a check-in at 375px (88.6.1-30)', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    '88.6.1-30: the focus targets, the RF1 layout and the pressed Start poll are phone-forward checks (375x667), so this spec runs only in the phone project',
  );

  let hold: WriteHold;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any mock and before navigation, so it is the last resort.
    hold = await holdWrites(page);
  });

  test.afterEach(() => expectNoApiWrites(hold));

  test('E1: Cancel on the phone delete confirm hands focus back to the Schedule actions trigger', async ({ page }) => {
    await mockSettings(page, { current: 'fixture' });
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    const { trigger, list } = await openScheduleMenu(page);
    await activate(page, list.getByRole('button', { name: 'Delete', exact: true }));
    // The confirm row is open and ScheduleList moved focus onto its Cancel control (88.6.1 code
    // review A-43: opening the inline confirm focuses Cancel so a keyboard or VoiceOver user lands
    // inside the row it just revealed; KebabMenu's trigger restore ran first and was superseded).
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await activate(page, page.getByRole('button', { name: 'Cancel', exact: true }));

    await expect(trigger).toBeFocused();
    await expect(page.getByRole('button', { name: 'Confirm Delete', exact: true })).toHaveCount(0);
  });

  test('E2: Confirm Delete lands on the heading; the failed refresh keeps the schedule under RF1 at 375px; Retry lands on the heading', async ({ page }) => {
    const mode: { current: SettingsMode } = { current: 'fixture' };
    let deletes = 0;
    await mockSettings(page, mode);
    await page.route(
      (url) => url.pathname === SCHEDULE_PATH,
      async (route: Route) => {
        if (route.request().method() !== 'DELETE') {
          await route.fallback();
          return;
        }
        deletes += 1;
        // The refresh that follows the delete fails (the app retries a 5xx once).
        mode.current = 'failing';
        await route.fulfill({ status: 200, json: {} });
      },
    );
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    const { list } = await openScheduleMenu(page);
    await activate(page, list.getByRole('button', { name: 'Delete', exact: true }));
    await activate(page, page.getByRole('button', { name: 'Confirm Delete', exact: true }));

    await expect(sectionHeading(page)).toBeFocused();
    expect(deletes).toBe(1);

    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 10_000 });
    const noticeRow = retry.locator('..');
    await expect(noticeRow).toContainText(RF1);
    await expect(page.getByText("We couldn't load your schedules")).toHaveCount(0);
    const scheduleHeading = page.getByRole('heading', { level: 3, name: SCHEDULE.template_name, exact: true });
    await expect(scheduleHeading).toBeVisible();

    // C8 (d): Retry is a real phone target, inside the viewport, above the content it qualifies.
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project sets a viewport').not.toBeNull();
    const retryBox = await retry.boundingBox();
    expect(retryBox, 'Retry has a box').not.toBeNull();
    expect(retryBox!.width, `Retry measured ${retryBox!.width}px wide`).toBeGreaterThanOrEqual(44);
    expect(retryBox!.height, `Retry measured ${retryBox!.height}px tall`).toBeGreaterThanOrEqual(44);
    expect(retryBox!.x).toBeGreaterThanOrEqual(0);
    expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(viewport!.width);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, 'the page must not scroll sideways').toBeLessThanOrEqual(clientWidth);
    const rowBox = await noticeRow.boundingBox();
    const scheduleBox = await scheduleHeading.boundingBox();
    expect(rowBox, 'the notice row has a box').not.toBeNull();
    expect(scheduleBox, 'the schedule heading has a box').not.toBeNull();
    expect(
      rowBox!.y + rowBox!.height,
      `the notice row ends at ${rowBox!.y + rowBox!.height}px; the schedule begins at ${scheduleBox!.y}px`,
    ).toBeLessThanOrEqual(scheduleBox!.y);

    // A keyboard Retry that succeeds: the notice leaves and focus lands on the section heading.
    mode.current = 'empty';
    await activate(page, retry);
    await expect(page.getByRole('heading', { name: 'No schedules yet', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
    await expect(sectionHeading(page)).toBeFocused();
  });

  test('E3: the pressed Start poll keeps focus while it works, then a proxy CSRF 403 announces R1', async ({ page }) => {
    let releasePost: () => void = () => {};
    const postReleased = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let posts = 0;
    await page.route(
      (url) => url.pathname === '/api/prompts',
      async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }
        posts += 1;
        await postReleased;
        await route.fulfill({ status: 403, json: CSRF_BODY });
      },
    );
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    const opener = page.getByRole('button', { name: '+ Start a check-in', exact: true });
    await expect(opener).toBeVisible({ timeout: 15_000 });
    await activate(page, opener);
    const dialog = page.getByRole('dialog', { name: 'Start a check-in' });
    await expect(dialog).toBeVisible();

    // Matched by role and either label, because the label itself changes while it works.
    const submit = dialog.getByRole('button', { name: /^(Start poll|Starting\.\.\.)$/ });
    await activate(page, submit);

    await expect(submit).toHaveText('Starting...');
    await expect(submit).toBeFocused();
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await expect(submit).not.toHaveAttribute('disabled');
    // The dialog's zoom-in is still running at this point; boundingBox() reads the transformed box.
    await settleAnimations(dialog);
    const submitBox = await submit.boundingBox();
    expect(submitBox, 'Start poll has a box').not.toBeNull();
    expect(submitBox!.height, `Start poll measured ${submitBox!.height}px tall`).toBeGreaterThanOrEqual(44);
    // A second Enter while it works sends nothing.
    await page.keyboard.press('Enter');
    expect(posts).toBe(1);

    releasePost();
    await expect(dialog.getByRole('alert')).toHaveText(R1);
    await expect(submit).toHaveText('Start poll');
    await expect(submit).not.toHaveAttribute('aria-disabled');
    expect(posts).toBe(1);
  });
});
