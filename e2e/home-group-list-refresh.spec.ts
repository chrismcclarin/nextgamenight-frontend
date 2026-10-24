import { test, expect, type Locator, type Page, type Request, type Route } from '@playwright/test';

import { E2E_GROUP_ID } from './support/groupSettings';
import { expectNoApiWrites, holdWrites, settleAnimations } from './support/inFlight';

/**
 * Phase 88.6.1-41 (D-37, Req 9; Req 5 H8 save, D-07) — a Group Settings save refreshes the HOME
 * group list without blanking it, and the gear keeps focus. PHONE PROJECT ONLY (375 x 667).
 *
 * WHAT IT PROVES, in a real browser at phone width:
 * - D-37: while the list's refresh after a save is in flight, "Loading groups..." does not
 *   replace the list and the edited card stays on screen (before this plan every refresh
 *   blanked the whole list for the loader and redrew it);
 * - H8 save: the settings dialog's own close restore (plan 88.6.1-20) lands on the gear that
 *   opened it, because the list no longer unmounts that gear in the same batch as the close.
 *   Save is aria-disabled while saving, never disabled natively, so it keeps focus until the
 *   dialog closes:
 *   src/app/components/GroupSettings.js ("onClick={handleSave} aria-disabled={saving || undefined}")
 *   and DECISION Phase 88.6.1-43. This spec shows, in a real browser at 375px with the list
 *   refresh held in flight, that the close restore lands on the gear (grouplist.focus.test.tsx
 *   F6 is the unit half). The gear still has focus after the refresh lands.
 *
 * IT NEVER WRITES THE FIXTURE. The settings PUT is fulfilled IN THE BROWSER with a minimal body
 * and never leaves it; the groups GETs are only delayed, then continued unchanged. It never
 * types, never deletes, never confirms anything, and never presses Escape on a dirty form.
 *
 * WHAT IT CANNOT SEE: a server-side reorder (#46). The PUT never reaches the backend, so the
 * server's row order never changes and the edited card never moves. The reorder case (a card
 * the refresh only moves keeps its focused control) is pinned only by the unit arm F8 in
 * src/app/components/grouplist.focus.test.tsx.
 *
 * SELECTORS: role, label and text, plus the one contract attribute `data-testid="group-card"`
 * (DECISION Phase 88.6-47 in grouplist.js: it exists so tests address the CARD). The gear is
 * matched by the name prefix /^Customize\b/ so plan 88.6.1-54's rename (D-19) does not break it.
 *
 * CI-RUN ONLY: the phone project needs the `.auth/user.json` login state, which exists only in
 * CI (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
 */

// The browser calls the same-origin BFF, so the reads are `/api/groups/user/<uuid>` (the home
// list's own refresh AND the home page's parallel getGroupList) and the save is
// `PUT /api/groups/<id>/settings`.
const isGroupsListRead = (url: URL) => url.pathname.includes('/groups/user/');
const isSettingsWrite = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/settings`);

/**
 * Plan 88.6.1-41's drive, extracted by plan 88.6.1-62 so its phone test reuses it (no second
 * copy). The seeded owner's group card (Weekend Warriors, the group the fixture emits as
 * E2E_GROUP_ID) and its gear, each with a count-1 vacuity guard.
 */
async function homeGroupGear(page: Page): Promise<{ card: Locator; gear: Locator }> {
  const card = page
    .getByTestId('group-card')
    .filter({ has: page.getByText('Weekend Warriors', { exact: true }) });
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Vacuity guards: exactly one card and one gear, or every later assertion is about nothing.
  await expect(card).toHaveCount(1);
  const gear = card.getByRole('button', { name: /^Customize\b/ });
  await expect(gear).toHaveCount(1);
  return { card, gear };
}

/**
 * Saves the group's settings through the gear, keyboard-first. The PUT is fulfilled IN THE
 * BROWSER with a minimal body and never leaves it (the save reads only `color_preset`).
 */
async function saveSettingsVia(page: Page, gear: Locator): Promise<void> {
  await page.route(isSettingsWrite, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, json: { id: E2E_GROUP_ID, color_preset: null } });
  });
  await gear.focus();
  await gear.press('Enter');
  await expect(page.getByRole('heading', { name: 'Customize Group' })).toBeVisible();
  await page.getByRole('button', { name: 'Save Changes' }).click();
}

test.describe('Phase 88.6.1-41 — the home group list refreshes in place (phone project)', () => {
  // Same phone-only guard idiom as group-settings-danger.spec.ts: both projects match every
  // spec, and this is a phone-tenet proof measured at 375px.
  test.skip(({ isMobile }) => !isMobile, 'D-37 / H8 phone proof — phone project only');

  test('a settings save refreshes the home group list without blanking it, and the gear keeps focus (88.6.1-41)', async ({
    page,
  }) => {
    await page.goto('/');

    const { card, gear } = await homeGroupGear(page);

    // Installed only now, so the first load is never held.
    const held: Route[] = [];
    let released = false;
    await page.route(isGroupsListRead, async (route) => {
      if (released) {
        await route.continue();
        return;
      }
      held.push(route);
    });
    const listReadStarted = page.waitForRequest((request) =>
      isGroupsListRead(new URL(request.url())),
    );

    await saveSettingsVia(page, gear);
    const settingsHeading = page.getByRole('heading', { name: 'Customize Group' });

    // POSITIVE signal: the refresh after the save has started (and is held).
    await listReadStarted;
    await expect(settingsHeading).toHaveCount(0);
    // While the refresh is in flight: no loader in the list's place, the edited card still shown.
    expect(await page.getByText('Loading groups...').count()).toBe(0);
    await expect(card).toBeVisible();
    // The dialog's close restore found the gear still connected.
    await expect(gear).toBeFocused();

    // Release every held read; the gear keeps focus once the refresh lands.
    const listReadAnswered = page.waitForResponse((response) =>
      isGroupsListRead(new URL(response.url())),
    );
    released = true;
    for (const route of held.splice(0)) {
      await route.continue();
    }
    await listReadAnswered;
    await expect(gear).toBeFocused();
  });

  /**
   * Phase 88.6.1-77 (AC-29 / RF1, D-51; 88.6.1-70 contract C8 d) — a failed REFRESH of the home
   * group list keeps the cards on screen under plan 70's shared notice, at 375px.
   *
   * WHAT IT PROVES: the notice sits between the "Your Groups" heading and the first card; its
   * Retry is at least 44 by 44 and fully inside the viewport once scrolled to; nothing scrolls
   * sideways; and Retry recovers, landing focus on "Your Groups".
   *
   * IT WRITES NOTHING. The refresh is the bell's own `nggroups:refresh` signal (no write is made),
   * and only the groups-list GET is answered IN THE BROWSER (a 500 while failing); every other
   * request is handed on untouched, and any write is held by the backstop and fails the test.
   *
   * CI-RUN ONLY (no local `.auth`, FE-TESTING-CONVENTIONS C-14): typechecked and listed locally.
   * A failed overlap, reachability, size or sideways-scroll assertion is a STOP for the owner's
   * mockup, never a restyle of the notice or the list.
   */
  test('a failed refresh keeps the cards under the refresh notice at 375px, and Retry recovers (88.6.1-77)', async ({
    page,
  }) => {
    // Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7).
    const RF1 = "Couldn't refresh. Showing what loaded earlier.";

    try {
      await page.goto('/');

      const card = page
        .getByTestId('group-card')
        .filter({ has: page.getByText('Weekend Warriors', { exact: true }) });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toHaveCount(1);
      const heading = page.getByRole('heading', { level: 2, name: 'Your Groups' });
      await expect(heading).toHaveCount(1);

      // Installed only now, so the first load is never touched. The backstop holds any write.
      const hold = await holdWrites(page);
      let mode: 'fail' | 'pass' = 'pass';
      let served500 = 0;
      await page.route(isGroupsListRead, async (route) => {
        if (route.request().method() !== 'GET' || mode !== 'fail') {
          await route.fallback();
          return;
        }
        served500 += 1;
        await route.fulfill({ status: 500, json: { message: 'Internal error' } });
      });
      mode = 'fail';

      // The bell's own accept signal: the home page bumps the list's refresh key.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('nggroups:refresh')));

      // POSITIVE: the visible RF1 line (the notice's span; its sr-only status region also holds
      // the sentence and still has a box, plan 88.6.1-73's CI lesson).
      const line = page.getByText(RF1, { exact: true }).and(page.locator('span'));
      await expect(line).toBeVisible({ timeout: 15_000 });
      await expect(card).toBeVisible();
      expect(served500, 'at least one 500 was served to the groups read').toBeGreaterThan(0);

      await settleAnimations(page.locator('body'));
      const headingBox = await heading.boundingBox();
      const lineBox = await line.boundingBox();
      const cardBox = await card.boundingBox();
      expect(headingBox, 'the heading has a box').not.toBeNull();
      expect(lineBox, 'the RF1 line has a box').not.toBeNull();
      expect(cardBox, 'the card has a box').not.toBeNull();
      expect(
        lineBox!.y,
        'STOP (owner mockup): the notice must sit below "Your Groups"',
      ).toBeGreaterThanOrEqual(headingBox!.y + headingBox!.height);
      expect(
        lineBox!.y + lineBox!.height,
        'STOP (owner mockup): the notice must sit above the first card',
      ).toBeLessThanOrEqual(cardBox!.y);

      const retry = page.getByRole('button', { name: 'Retry', exact: true });
      await expect(retry).toHaveCount(1);
      await retry.scrollIntoViewIfNeeded();
      await expect(retry).toBeInViewport({ ratio: 1 });
      const retryBox = await retry.boundingBox();
      expect(retryBox, 'Retry has a box').not.toBeNull();
      expect(retryBox!.width, 'STOP (owner mockup): Retry is narrower than 44px').toBeGreaterThanOrEqual(44);
      expect(retryBox!.height, 'STOP (owner mockup): Retry is shorter than 44px').toBeGreaterThanOrEqual(44);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(sideways, 'STOP (owner mockup): the page scrolls sideways').toBe(true);

      // Retry recovers: the next groups read goes through to the server.
      mode = 'pass';
      const recovered = page.waitForResponse(
        (response) =>
          isGroupsListRead(new URL(response.url())) &&
          response.request().method() === 'GET' &&
          response.status() === 200,
      );
      await retry.click();
      await recovered;
      await expect(page.getByText(RF1, { exact: true }).and(page.locator('span'))).toHaveCount(0);
      await expect(heading).toBeFocused();
      await expect(card).toBeVisible();
      expectNoApiWrites(hold);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  /**
   * Phase 88.6.1-62 (Req 9, D-09a / D-37 / D-41; RF1 / D-51; 88.6.1-70 contract C8 d and f1 / C12)
   * — the home page's upcoming events through a real settings save, at 375px.
   *
   * WHAT IT PROVES, in a real browser at phone width:
   * - D-09a / D-37: while the refresh after a save is held, the Calendar button keeps its count
   *   (`Calendar, 1 upcoming game this week`) instead of dropping to the bare `Calendar`;
   * - after a failed refresh (a synthetic 500) the button makes no count claim, and — owner ruling
   *   #229, accepted limitation — no status region outside the CLOSED sheet carries the RF1
   *   sentence (CONFIRM-ONLY: green before this plan and after it);
   * - C8 d: in the Calendar sheet the RF1 notice sits ABOVE the retained event, its Retry is inside
   *   the viewport and at least 44 by 44, the full banner and the hero are absent, and nothing
   *   scrolls sideways;
   * - C8 f1 / C12 (step 7): with the event's row focused, an automatic re-attempt nobody pressed
   *   (the tab-return `visibilitychange`) is answered 403 — the event is withdrawn behind
   *   `We couldn't load your calendar` and focus lands on the sheet's `Calendar` title, never
   *   `<body>` (the card's heading is display:none here, and the guard passes no target while the
   *   sheet is open, r2 #225).
   *
   * NO WRITE LEAVES THE BROWSER: the settings PUT is fulfilled by `saveSettingsVia`, and every
   * upcoming-events GET this page makes is answered by the test (a 200 with one synthetic event,
   * then synthetic 500s, then 403s). The desktop calendar's own read (`include_rsvp_summary`) and
   * the group-list reads are handed on untouched. No screenshot or attachment (DECISION 88.6-59),
   * and no response body is printed.
   *
   * CI-RUN ONLY (no local `.auth`, FE-TESTING-CONVENTIONS C-14): typechecked and listed locally.
   * A failed layout assertion (step 6) is a STOP for the owner's mockup, never a restyle; a red in
   * step 7 is a defect in the guard path, never a restyle.
   */
  test('a settings save keeps the upcoming count, and a failed refresh keeps the event under the RF1 notice (88.6.1-62)', async ({
    page,
  }) => {
    // Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7).
    const RF1 = "Couldn't refresh. Showing what loaded earlier.";
    const GAME = 'Refresh Check Game';
    const isPageEventsRead = (url: URL) =>
      url.pathname.includes('/events/user/') && !url.searchParams.has('include_rsvp_summary');

    // Step 1: every page upcoming-events GET is answered here. Before the save: a 200 with one
    // synthetic in-window event. After it: each GET signals "refresh seen", waits for the
    // release, then answers 500 — until `withdraw` (step 7), from when every GET answers 403.
    let saving = false;
    let withdraw = false;
    let signalRefreshSeen: () => void = () => {};
    const refreshSeen = new Promise<void>((resolve) => {
      signalRefreshSeen = resolve;
    });
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(isPageEventsRead, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      if (withdraw) {
        await route.fulfill({ status: 403, json: { error: 'synthetic' } });
        return;
      }
      if (!saving) {
        await route.fulfill({
          status: 200,
          json: [
            {
              id: '6f2c1d4e-62aa-4c62-9e62-000000000062',
              group_id: E2E_GROUP_ID,
              start_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
              status: 'scheduled',
              duration_minutes: 120,
              Game: { name: GAME },
              Group: { name: 'Weekend Warriors' },
              EventParticipations: [],
            },
          ],
        });
        return;
      }
      signalRefreshSeen();
      await released;
      await route.fulfill({ status: 500, json: { error: 'synthetic' } });
    });

    try {
      // Step 2.
      await page.goto('/');
      const calendarButton = page.getByRole('button', { name: /^calendar\b/i });
      await expect(calendarButton).toHaveAccessibleName('Calendar, 1 upcoming game this week', {
        timeout: 15_000,
      });

      // Step 3: the group-list reads the save triggers are not routed here; track them so a
      // failed one (its own RF1 notice) is never blamed on #229 below.
      const { gear } = await homeGroupGear(page);
      let groupGetsInFlight = 0;
      const groupGetStatuses: Array<number | 'failed'> = [];
      const isGroupGet = (req: Request) =>
        req.method() === 'GET' && isGroupsListRead(new URL(req.url()));
      page.on('request', (req) => {
        if (isGroupGet(req)) groupGetsInFlight += 1;
      });
      page.on('requestfinished', async (req) => {
        if (!isGroupGet(req)) return;
        groupGetStatuses.push((await req.response())?.status() ?? 'failed');
        groupGetsInFlight -= 1;
      });
      page.on('requestfailed', (req) => {
        if (!isGroupGet(req)) return;
        groupGetStatuses.push('failed');
        groupGetsInFlight -= 1;
      });
      saving = true;
      await saveSettingsVia(page, gear);

      // Step 4: the refresh is held; the count stays.
      await refreshSeen;
      await expect(calendarButton).toHaveAccessibleName('Calendar, 1 upcoming game this week');

      // Step 5: the refresh fails; no count claim while the error shows (the shipped rule).
      const failed = page.waitForResponse(
        (response) => isPageEventsRead(new URL(response.url())) && response.status() === 500,
      );
      release();
      await failed;
      await expect(calendarButton).toHaveAccessibleName('Calendar');
      await expect.poll(() => groupGetsInFlight).toBe(0);
      expect(
        groupGetStatuses.every((st) => typeof st === 'number' && st < 400),
        'a group list refresh failed in this run, so its own RF1 notice may be showing — not a #229 regression',
      ).toBe(true);
      expect(groupGetStatuses.length, 'the save refreshed the group list').toBeGreaterThan(0);
      // Owner ruling #229 (2026-10-13, option 1; 88.6.1-PLAN-REVIEW-work/RULINGS.md): with the
      // sheet CLOSED a failed refresh is announced nowhere outside it — the button drops to the
      // bare `Calendar`. REJECTED: an sr-only announcement a sighted phone user never sees
      // (option 2) and a visible line about content not on screen (option 3). CONFIRM-ONLY: a
      // status region outside the sheet carrying RF1 turns this red.
      await expect(page.getByRole('status').filter({ hasText: RF1 })).toHaveCount(0);

      // Step 6: the sheet keeps the event under the RF1 notice (contract C8 d).
      await calendarButton.click();
      const dialog = page.getByRole('dialog', { name: 'Calendar' });
      await expect(dialog).toBeVisible();
      const row = dialog.getByRole('button', { name: new RegExp(GAME) });
      await expect(row).toBeVisible();
      const line = dialog.getByText(RF1, { exact: true }).and(page.locator('span'));
      await expect(line).toBeVisible();
      await expect(dialog.getByText("We couldn't load your calendar")).toHaveCount(0);
      await expect(dialog.getByText('Next game night')).toHaveCount(0);
      const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
      await expect(retry).toHaveCount(1);
      await settleAnimations(dialog);
      await expect(retry).toBeInViewport({ ratio: 1 });
      const retryBox = await retry.boundingBox();
      const rowBox = await row.boundingBox();
      expect(retryBox, 'Retry has a box').not.toBeNull();
      expect(rowBox, 'the event row has a box').not.toBeNull();
      expect(retryBox!.width, 'STOP (owner mockup): Retry is narrower than 44px').toBeGreaterThanOrEqual(44);
      expect(retryBox!.height, 'STOP (owner mockup): Retry is shorter than 44px').toBeGreaterThanOrEqual(44);
      expect(retryBox!.y, 'STOP (owner mockup): the notice must sit above the event').toBeLessThan(rowBox!.y);
      const noSideways = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noSideways, 'STOP (owner mockup): the page scrolls sideways').toBe(true);

      // Step 7 (C8 f1 / C12 at 375px): the focused event is withdrawn by a 403 to the re-attempt
      // nobody pressed; focus lands on the sheet's title.
      await row.focus();
      await expect(row).toBeFocused();
      withdraw = true;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(dialog.getByText("We couldn't load your calendar")).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByText(GAME)).toHaveCount(0);
      await expect(dialog.getByText(RF1, { exact: true }).and(page.locator('span'))).toHaveCount(0);
      await expect(dialog.getByRole('heading', { name: 'Calendar', exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
