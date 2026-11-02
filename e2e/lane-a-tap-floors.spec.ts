import { test, expect, type Locator, type Page } from '@playwright/test';

import { assertTheme, forceLightMode } from './support/contrast';
import { openCreateEventDialog } from './support/createEvent';
import { E2E_GROUP_ID } from './support/groupSettings';
import { expectTouchTarget, roundPx } from './support/touchTarget';

// Phase 88.9 plan 04 (lane A, the 375 tap floors): the size picks A7a + O3a (the two tab strips,
// with Sent widened to 44), A8b (the removed-member Dismiss to 48 x 48 with the notice held at
// 66px) and A9a + O3a (the text-button family: create-event's Switch link and three week buttons,
// the footer Report bug, the month grid's Go to Today), pinned at 375 x 667 in BOTH themes (SPEC
// R4 / AC-4: at least 44px in dark and in light). The UI-SPEC rows they pin are E7, E8 and E9:
// planning:.planning/phases/88.9-fe-look-decisions-design-phase-mockup-gated-split-from-88-6/88.9-UI-SPEC.md ("Lane-A build contract").
// Every test is red on the pre-fix tree on its measured size; the fixes land in a later plan.
//
// THEME: no file-level hook. The theme check is a class assertion on the html element
// (e2e/support/contrast.ts ("export async function assertTheme(")), which times out on about:blank,
// and the light switch is an init script (e2e/support/contrast.ts ("export async function forceLightMode("))
// that takes effect at the next navigation; a file-level hook would also run before every nested
// describe's hooks. So each test checks its theme right after its own first navigation, and the
// light describe forces light in its own hook BEFORE any navigation.
//
// WRITES NOTHING: every test loads a page, opens at most the create-event dialog without
// submitting it, and reads boxes. No route is held or released.
//
// NOT RUN LOCALLY (no stored sign-in locally): typecheck and listing are the local proof; the CI
// e2e job (phone project) is the proof.

// DECISION Phase 88.9-04: no capture of any kind on this spec (no failure screenshot, no retry
// trace, no video), chosen OVER the shared failure screenshot and the retry trace that the config
// would otherwise take (playwright.config.ts ("retries: process.env.CI ? 1 : 0,"), playwright.config.ts ("trace: 'on-first-retry',"),
// playwright.config.ts ("screenshot: 'only-on-failure',")) and that CI keeps, encrypted, for seven
// days (.github/workflows/ci.yml ("bash scripts/encrypt-evidence.sh --name playwright-report")). This spec loads the e2e
// account's REAL home page (the removed-member notice) and its REAL friends page, so it follows
// the rule of e2e/home-removed-notice.spec.ts ("DECISION Phase 88.6.1 code review WR-02") and
// e2e/friend-invite-panel-header.spec.ts ("DECISION Phase 88.6.1-27"): the WR-02 / 88.6.1-27 rule.
// Failure lines carry box sizes only, never page text. Saying nothing here is NOT the same thing:
// the shared use block would capture on failure. Re-enabling capture is a decision, not a cleanup.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test.skip(({ isMobile }) => !isMobile, 'phone-only: the 375 tap floors of 88.9 lane A');

type Theme = 'dark' | 'light';

const GROUP_PAGE = `/groupHomePage?id=${E2E_GROUP_ID}`;
const REGION = '[data-testid="removed-from-group-status"]';
const REMOVED_SENTENCE = "You're no longer a member of that group.";

/** The page, then the theme check: the order every test here keeps (see the header). */
async function openPage(page: Page, path: string, theme: Theme): Promise<void> {
  await page.goto(path);
  await assertTheme(page, theme);
}

/** How many line boxes the control's contents occupy (rects whose vertical ranges overlap share a line). */
async function lineCount(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const r of rects) {
      if (r.top >= bottom - 1) {
        lines += 1;
        bottom = r.bottom;
      } else {
        bottom = Math.max(bottom, r.bottom);
      }
    }
    return lines;
  });
}

async function expectOneLine(locator: Locator, label: string): Promise<void> {
  const lines = await lineCount(locator);
  expect(lines, `${label}: the label sits on ${lines} lines, not 1`).toBe(1);
}

/** The strip (the tabs' parent) does not scroll sideways at 375. */
async function expectStripFits(tab: Locator, label: string): Promise<void> {
  const { scrollWidth, clientWidth } = await tab.locator('xpath=..').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth, `${label}: the strip overflows (scrollWidth ${scrollWidth}px, clientWidth ${clientWidth}px)`).toBeLessThanOrEqual(clientWidth);
}

async function friendsTabs(page: Page, theme: Theme): Promise<void> {
  await openPage(page, '/friends', theme);
  const tabs: Array<[string, Locator]> = [
    ['Friends', page.getByRole('button', { name: /^Friends(\s*\d+)?$/ })],
    ['Requests', page.getByRole('button', { name: /^Requests(\s*\d+)?$/ })],
    ['Sent', page.getByRole('button', { name: /^Sent(\s*\d+)?$/ })],
  ];
  await expect(tabs[0][1], 'the friends page tab strip rendered').toBeVisible({ timeout: 15_000 });
  for (const [name, tab] of tabs) {
    await expectTouchTarget(tab, `friends ${name} tab (A7a + O3a, ${theme})`, { axes: 'both' });
  }
  await expectStripFits(tabs[0][1], `friends tab strip (${theme})`);
  for (const [name, tab] of tabs) {
    await expectOneLine(tab, `friends ${name} tab (${theme})`);
  }
}

async function groupTabs(page: Page, theme: Theme): Promise<void> {
  await openPage(page, GROUP_PAGE, theme);
  const tabs: Array<[string, Locator]> = [
    ['Overview', page.getByRole('button', { name: 'Overview', exact: true })],
    ['Library', page.getByRole('button', { name: 'Library', exact: true })],
  ];
  await expect(tabs[0][1], 'the group page tab strip rendered').toBeVisible({ timeout: 15_000 });
  for (const [name, tab] of tabs) {
    await expectTouchTarget(tab, `group ${name} tab (A7a + O3a, ${theme})`, { axes: 'both' });
  }
  await expectStripFits(tabs[0][1], `group tab strip (${theme})`);
  for (const [name, tab] of tabs) {
    await expectOneLine(tab, `group ${name} tab (${theme})`);
  }
}

async function removedDismiss(page: Page, theme: Theme): Promise<void> {
  await openPage(page, '/?removedFrom=' + encodeURIComponent('E2E removed group'), theme);
  const region = page.locator(REGION);
  await expect(region, 'the removed-member notice arrived').toHaveText(REMOVED_SENTENCE, { timeout: 15_000 });

  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  const box = await dismiss.boundingBox();
  expect(box, 'removed-notice Dismiss: boundingBox() returned null — not rendered').not.toBeNull();
  if (!box) return;
  const measured = `${box.width}px wide x ${box.height}px tall`;
  // The A8b floor is 48, above the 44 that expectTouchTarget floors at, so the numbers are asserted directly.
  expect(roundPx(box.width), `removed-notice Dismiss (A8b, ${theme}): width is below 48px (${measured})`).toBeGreaterThanOrEqual(48);
  expect(roundPx(box.height), `removed-notice Dismiss (A8b, ${theme}): height is below 48px (${measured})`).toBeGreaterThanOrEqual(48);

  const noticeHeight = await region.locator('xpath=..').evaluate((el) => el.getBoundingClientRect().height);
  expect(noticeHeight, `removed notice (E8, ${theme}): height ${noticeHeight}px is not 66px`).toBeGreaterThanOrEqual(65.5);
  expect(noticeHeight, `removed notice (E8, ${theme}): height ${noticeHeight}px is not 66px`).toBeLessThanOrEqual(66.5);
}

async function createEventControls(page: Page, theme: Theme): Promise<void> {
  // openCreateEventDialog does not navigate, so the page and the theme check come first.
  await openPage(page, GROUP_PAGE, theme);
  await openCreateEventDialog(page);

  const switchLink = page.getByRole('button', { name: 'Switch to Manual Entry', exact: true });
  const prev = page.getByRole('button', { name: 'Previous week', exact: true });
  const jump = page.getByRole('button', { name: 'Jump to current week', exact: true });
  const next = page.getByRole('button', { name: 'Next week', exact: true });
  await expect(prev, 'the create-event week navigation rendered').toBeVisible({ timeout: 15_000 });

  await expectTouchTarget(switchLink, `create-event Switch link (A9a, ${theme})`, { axes: 'height' });
  await expectTouchTarget(prev, `create-event Previous week (A9a + O3a, ${theme})`, { axes: 'both' });
  await expectTouchTarget(jump, `create-event Jump to current week (A9a, ${theme})`, { axes: 'height' });
  await expectTouchTarget(next, `create-event Next week (A9a + O3a, ${theme})`, { axes: 'both' });

  await expectOneLine(switchLink, `create-event Switch link (${theme})`);
  await expectOneLine(prev, `create-event Previous week (${theme})`);
  await expectOneLine(jump, `create-event Jump to current week (${theme})`);
  await expectOneLine(next, `create-event Next week (${theme})`);
}

async function reportBugAndGoToToday(page: Page, theme: Theme): Promise<void> {
  await openPage(page, GROUP_PAGE, theme);

  // A stored calendar preference can reopen the list view; the month grid holds Go to Today.
  const viewToggle = page.getByRole('button', { name: /^(List|Month) View$/ });
  await expect(viewToggle, 'the group calendar rendered').toBeVisible({ timeout: 20_000 });
  if ((await viewToggle.textContent())?.trim() === 'Month View') await viewToggle.click();
  const today = page.getByRole('button', { name: 'Go to Today', exact: true });
  await expect(today, 'the month grid rendered Go to Today').toBeVisible();

  const reportBug = page.getByRole('button', { name: 'Report bug or suggest feature', exact: true });
  await reportBug.scrollIntoViewIfNeeded();
  await expect(reportBug, 'the footer Report bug rendered').toBeVisible();

  await expectTouchTarget(reportBug, `footer Report bug (A9a, ${theme})`, { axes: 'height' });
  await today.scrollIntoViewIfNeeded();
  await expectTouchTarget(today, `month grid Go to Today (A9a, ${theme})`, { axes: 'height' });

  await expectOneLine(reportBug, `footer Report bug (${theme})`);
  await expectOneLine(today, `month grid Go to Today (${theme})`);
}

test.describe('lane A tap floors at 375 — dark (88.9)', () => {
  test('A7a + O3a (88.9): the three friends tabs are at least 44 x 44 at 375, dark', async ({ page }) => {
    await friendsTabs(page, 'dark');
  });

  test('A7a + O3a (88.9): the two group page tabs are at least 44 x 44 at 375, dark', async ({ page }) => {
    await groupTabs(page, 'dark');
  });

  test('A8b (88.9): the removed-member Dismiss is at least 48 x 48 and the notice stays 66px tall, dark', async ({ page }) => {
    await removedDismiss(page, 'dark');
  });

  test("A9a + O3a (88.9): create-event's Switch link and three week buttons clear 44px tall, the two arrows 44px wide, dark", async ({
    page,
  }) => {
    await createEventControls(page, 'dark');
  });

  test("A9a (88.9): the footer Report bug and the month grid's Go to Today clear 44px tall, dark", async ({ page }) => {
    await reportBugAndGoToToday(page, 'dark');
  });
});

test.describe('lane A tap floors at 375 — light (88.9)', () => {
  test.use({ colorScheme: 'light' });

  test.beforeEach(async ({ page }) => {
    // Before any navigation: the init script lands at the test's first goto (see the header).
    await forceLightMode(page);
  });

  test('A7a + O3a (88.9): the three friends tabs are at least 44 x 44 at 375, light', async ({ page }) => {
    await friendsTabs(page, 'light');
  });

  test('A7a + O3a (88.9): the two group page tabs are at least 44 x 44 at 375, light', async ({ page }) => {
    await groupTabs(page, 'light');
  });

  test('A8b (88.9): the removed-member Dismiss is at least 48 x 48 and the notice stays 66px tall, light', async ({ page }) => {
    await removedDismiss(page, 'light');
  });

  test("A9a + O3a (88.9): create-event's Switch link and three week buttons clear 44px tall, the two arrows 44px wide, light", async ({
    page,
  }) => {
    await createEventControls(page, 'light');
  });

  test("A9a (88.9): the footer Report bug and the month grid's Go to Today clear 44px tall, light", async ({ page }) => {
    await reportBugAndGoToToday(page, 'light');
  });
});
