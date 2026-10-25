import { test, expect, type APIResponse, type Page, type Route } from '@playwright/test';

import { forceLightMode } from './support/contrast';
import {
  expectGatedPair,
  expectNoApiWrites,
  holdWrites,
  settleAnimations,
  type WriteHold,
} from './support/inFlight';
import { scrubbedFetch } from './support/scrubbedFetch';

/**
 * Phase 88.6.1-42 (D-09a, Req 9; Req 5 H1, D-05 as amended by D-57) — Manage Members at 375px.
 * PHONE PROJECT ONLY (iPhone SE, 375 x 667).
 *
 * WHAT IT PROVES, in a real browser at phone width:
 * - D-09a: while the refresh after a phone remove is in flight, the roster stays painted and
 *   "Loading members..." never replaces it (before this plan every refresh blanked the roster);
 * - Req 5 H1: when that refresh removes the row whose member-actions button holds focus, focus
 *   lands on the NEXT row's member-actions button. At 375px the row's desktop controls are
 *   hidden, which jsdom (no CSS) cannot show; the unit half is F1 in
 *   src/app/components/ManageMembers.mutations.test.tsx;
 * - Req 9 / SPEC Prohibition 2: a failed FIRST load shows the members banner, never the empty
 *   roster sentence, and fits the phone.
 * The failed-REFRESH phone proof (the RF1 notice above kept rows) is plan 88.6.1-78's, added to
 * this spec.
 *
 * IT NEVER WRITES THE FIXTURE. The seeded group is shared by other specs, so the removed member
 * is SYNTHETIC: it exists only in members responses augmented in the browser, and the DELETE for
 * it is fulfilled in the browser and counted. Every other method on these paths falls back.
 *
 * SELECTORS: role, label and text only; every roster locator is scoped to the dialog, because
 * the group page's own member stack also receives the synthetic members.
 *
 * CI-RUN ONLY: the phone project needs the `.auth/user.json` login state, which exists only in
 * CI (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
 */

/* The seeded group minted by the backend's scripts/e2e-fixtures.js in CI. No '1' fallback (the
   event-scheduler-touch.spec.ts idiom): a fallback id would route a group the fixtures do not
   own, and every assertion here would prove nothing. The beforeEach turns an unset var into one
   loud failure. */
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this spec routes a group the fixtures do not own.',
  ).toBeTruthy();
});

// Non-owner `member` rows that are not the viewer, so each renders its phone member-actions
// button (named from the username). Distinct ids, so the two rows key apart.
const SYNTH = {
  id: '00000000-0000-4000-8000-0000000000d1',
  user_id: 'auth0|e2e-synthetic-removable',
  username: 'E2E Removable',
  email: null,
  UserGroup: { role: 'member' },
};
const SYNTH_NEXT = {
  id: '00000000-0000-4000-8000-0000000000d2',
  user_id: 'auth0|e2e-synthetic-neighbour',
  username: 'E2E Neighbour',
  email: null,
  UserGroup: { role: 'member' },
};

// The browser calls the same-origin BFF: the members read is `GET /api/groups/<id>/users` and
// the remove is `DELETE /api/groups/<id>/users/<member id>` (src/lib/api.ts, getGroupMembers and
// removeUserFromGroup).
const isMembersRead = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`);
const isSynthRemove = (url: URL) =>
  url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users/${SYNTH.id}`);

/** The real roster from the backend, as an array (an empty one if the read was not a roster). */
async function realRoster(route: Route): Promise<{ response: APIResponse; body: unknown[] }> {
  const response = await scrubbedFetch(route);
  const json: unknown = await response.json();
  return { response, body: Array.isArray(json) ? json : [] };
}

/**
 * Answer every members GET with the real roster plus the rows `extraRows` returns, appended (any
 * other method on that path falls back). `extraRows` runs AFTER the real read and BEFORE the
 * answer, so a test can hold a read there. The ONE augmentation in this file (Phase 88.6.1-50
 * hoisted it out of the remove test when the transfer test needed it too; never a second copy).
 */
async function routeAugmentedRoster(
  page: Page,
  extraRows: () => unknown[] | Promise<unknown[]>,
): Promise<void> {
  await page.route(isMembersRead, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const { response, body } = await realRoster(route);
    const extra = await extraRows();
    await route.fulfill({ response, json: [...body, ...extra] });
  });
}

test.describe('Phase 88.6.1-42 — Manage Members refreshes in place (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'D-09a / Req 5 H1 phone proof — phone project only');

  // DECISION Phase 88.6.1-42 (wave 5 CI gate, CI run 38976822652): every route this file
  // registers is removed after each test with behavior 'ignoreErrors', before fixture teardown
  // closes the page. A members read the app sends after the last assertion was still inside
  // realRoster's route.fetch when the context closed; route.fetch threw "Target page, context
  // or browser has been closed", which failed a test that had passed, and printed request
  // headers into the public CI log. 'ignoreErrors' does not wait for a running handler and
  // silently catches anything it throws after unrouting (Playwright 1.60 Page.unrouteAll).
  // REJECTED: a try/catch inside realRoster that returns when the page is closed. The handler
  // cannot reliably tell "the page closed" from "the read failed" (isClosed may not have
  // flipped when the fetch rejects), and swallowing a real mid-test failure would turn a loud
  // error into a silent timeout. Assertions are unchanged.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test("a phone remove keeps the roster painted while it refreshes, then focus lands on the next member's actions button", async ({
    page,
  }) => {
    let removed = false;
    let deletes = 0;
    let postRemovalHeld = false;
    let releasePostRemoval!: () => void;
    const postRemovalGate = new Promise<void>((resolve) => {
      releasePostRemoval = resolve;
    });
    let markPostRemovalArrived!: () => void;
    const postRemovalArrived = new Promise<void>((resolve) => {
      markPostRemovalArrived = resolve;
    });

    await page.route(isSynthRemove, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      deletes += 1;
      removed = true;
      await route.fulfill({ status: 200, json: {} });
    });
    await routeAugmentedRoster(page, async () => {
      if (!removed) {
        // SYNTH_NEXT sits directly AFTER SYNTH, so the removed row's next neighbour never
        // depends on what the seeded group holds.
        return [SYNTH, SYNTH_NEXT];
      }
      if (!postRemovalHeld) {
        // The FIRST read after the removal is the dialog's own refresh: hold it.
        postRemovalHeld = true;
        markPostRemovalArrived();
        await postRemovalGate;
      }
      return [SYNTH_NEXT];
    });

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage).toBeVisible({ timeout: 15_000 });
    await manage.tap();

    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    const trigger = dialog.getByRole('button', { name: 'Member actions for E2E Removable' });
    const next = dialog.getByRole('button', { name: 'Member actions for E2E Neighbour' });
    await expect(next, 'the fixed neighbour row renders its member-actions button').toBeVisible();

    await trigger.tap();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Tap again to remove' }).tap();

    // POSITIVE signal: the refresh after the removal reached the route and is held.
    await postRemovalArrived;
    expect(deletes, 'the remove sent exactly one DELETE, fulfilled in the browser').toBe(1);
    await expect(dialog.getByText('(You)', { exact: true })).toBeVisible();
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    expect(
      await dialog.getByText('Loading members...').count(),
      'the refresh never puts the first-load line in the roster place',
    ).toBe(0);
    // Focus has not moved early: KebabMenu put it back on its own trigger.
    await expect(trigger).toBeFocused();

    releasePostRemoval();
    await expect(next, "focus lands on the next member's actions button").toBeFocused();
    await expect(dialog.getByText('E2E Removable', { exact: true })).toHaveCount(0);
    expect(deletes, 'still exactly one DELETE').toBe(1);
  });

  test('a failed first load shows the members banner, never an empty roster, at 375px', async ({
    page,
  }) => {
    // The group page loads its own members once identity resolves; wait for that read so the
    // failure below is served to the dialog's first load and to nothing else.
    const pageMembersRead = page.waitForResponse(
      (response) =>
        isMembersRead(new URL(response.url())) && response.request().method() === 'GET',
    );
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await pageMembersRead;
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage).toBeVisible({ timeout: 15_000 });

    let failures = 0;
    await page.route(isMembersRead, async (route) => {
      if (route.request().method() !== 'GET' || failures > 0) {
        await route.fallback();
        return;
      }
      failures += 1;
      await route.fulfill({ status: 500, json: { error: 'e2e synthetic failure' } });
    });
    await manage.tap();

    // With no roster loaded the caller has no role yet, so the title is the plain one.
    const dialog = page.getByRole('dialog', { name: 'Members', exact: true });
    await expect(dialog.getByText("Couldn't load members")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('No members found.')).toHaveCount(0);
    await expect(dialog.getByText('Loading members...')).toHaveCount(0);
    expect(failures, 'the failure was served exactly once').toBe(1);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits, 'the failed first load causes no horizontal page scroll').toBe(true);
  });

  /**
   * Phase 88.6.1-78 (AC-29 / RF1, D-51; 88.6.1-70 contract C8 d) — a failed REFRESH of the Manage
   * Members roster keeps the rows on screen under plan 70's shared notice, at 375px, through a
   * real close and reopen.
   *
   * WHAT IT PROVES: after the reopen's members read fails, the last roster stays (D-09a) with the
   * notice above the "(You)" row inside the dialog (pinned under the title, owner ruling #242);
   * its Retry is at least 44 by 44 and fully inside the viewport once scrolled to; nothing scrolls
   * sideways; and Retry recovers, landing focus on the "Manage Group Members" title.
   *
   * IT WRITES NOTHING. Only the members GET is answered IN THE BROWSER (a 500 while failing); no
   * row action is pressed; every other request falls back, and the write backstop holds any write
   * and fails the test if one reaches it.
   *
   * CI-RUN ONLY (no local `.auth`, FE-TESTING-CONVENTIONS C-14): typechecked and listed locally.
   * A failed overlap, reachability, size or sideways-scroll assertion is a STOP for the owner's
   * mockup, never a restyle of the notice or the dialog.
   */
  test('a failed refresh keeps the roster under the refresh notice at 375px, and Retry recovers (88.6.1-78)', async ({
    page,
  }) => {
    // Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7).
    const RF1 = "Couldn't refresh. Showing what loaded earlier.";

    try {
      // The group page loads its own members once identity resolves; wait for that read first.
      const pageMembersRead = page.waitForResponse(
        (response) =>
          isMembersRead(new URL(response.url())) && response.request().method() === 'GET',
      );
      await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
      await pageMembersRead;
      const manage = page.getByRole('button', { name: 'Manage Members' });
      await expect(manage).toBeVisible({ timeout: 15_000 });
      await manage.tap();

      const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const self = dialog.getByText('(You)', { exact: true });
      await expect(self).toBeVisible({ timeout: 15_000 });

      // A real close, with the dialog's own footer Close (ManageMembers' Modal.Footer action). Two
      // buttons are NAMED Close: the Modal header's x (aria-label="Close", text "x") and this one, so
      // the role locator is narrowed by its visible text (wave 7 CI gate, run 39020174955:
      // strict-mode, 2 elements).
      await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).tap();
      await expect(dialog).toHaveCount(0);

      // Installed only now, so the first load is never touched. The backstop holds any write; the
      // members route (registered after it, so it runs first) answers only the members GET.
      const hold = await holdWrites(page);
      let mode: 'fail' | 'pass' = 'pass';
      let served500 = 0;
      await page.route(isMembersRead, async (route) => {
        if (route.request().method() !== 'GET' || mode !== 'fail') {
          await route.fallback();
          return;
        }
        served500 += 1;
        await route.fulfill({ status: 500, json: { message: 'Internal error' } });
      });
      mode = 'fail';

      await manage.tap();

      // POSITIVE: the visible RF1 line (the notice's span; its sr-only status region also holds
      // the sentence and still has a box, plan 88.6.1-73's CI lesson).
      const line = dialog.getByText(RF1, { exact: true }).and(page.locator('span'));
      await expect(line).toBeVisible({ timeout: 15_000 });
      // D-09a: the reopen shows the last roster, kept under the notice.
      await expect(self).toBeVisible();
      await expect(dialog.getByText("Couldn't load members")).toHaveCount(0);
      expect(served500, 'at least one 500 was served to the members read').toBeGreaterThan(0);

      // boundingBox reads the transformed box; the dialog opens with a zoom animation.
      await settleAnimations(dialog);
      const lineBox = await line.boundingBox();
      const selfBox = await self.boundingBox();
      expect(lineBox, 'the RF1 line has a box').not.toBeNull();
      expect(selfBox, 'the (You) row has a box').not.toBeNull();
      expect(
        lineBox!.y + lineBox!.height,
        'STOP (owner mockup): the notice must sit above the (You) row',
      ).toBeLessThanOrEqual(selfBox!.y);

      const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
      await expect(retry).toHaveCount(1);
      await retry.scrollIntoViewIfNeeded();
      await expect(retry).toBeInViewport({ ratio: 1 });
      const retryBox = await retry.boundingBox();
      expect(retryBox, 'Retry has a box').not.toBeNull();
      expect(retryBox!.width, 'STOP (owner mockup): Retry is narrower than 44px').toBeGreaterThanOrEqual(44);
      expect(retryBox!.height, 'STOP (owner mockup): Retry is shorter than 44px').toBeGreaterThanOrEqual(44);
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(fits, 'STOP (owner mockup): the page scrolls sideways').toBe(true);

      // Retry recovers: the next members read goes through to the server.
      mode = 'pass';
      const recovered = page.waitForResponse(
        (response) =>
          isMembersRead(new URL(response.url())) &&
          response.request().method() === 'GET' &&
          response.status() === 200,
      );
      await retry.click();
      await recovered;
      await expect(dialog.getByText(RF1, { exact: true }).and(page.locator('span'))).toHaveCount(0);
      await expect(dialog.getByRole('heading', { name: 'Manage Group Members' })).toBeFocused();
      await expect(self).toBeVisible();
      expectNoApiWrites(hold);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

// Phase 88.6.1-50 (W016 rows 12-13 / D-35; Req 4, AC-12): a pressed Transfer ownership at 375px.
// WHAT IT PROVES THAT JSDOM CANNOT (C-11: jsdom never blurs a natively disabled element): in
// Chromium at phone width the pressed confirm keeps focus while the transfer runs, carries
// aria-disabled with no disabled attribute, paints the gated primary pair at opacity 1, and a
// second Enter sends no second request. It also presses Cancel in the stacked transfer dialog
// first and proves the roster dialog survives with focus back on the kebab that opened it (the
// production path the wave 5 Modal.tsx stacked-dismiss guard covers; TR3 is its unit pin).
// WHY IT IS SAFE, twice over: holdWrites is registered BEFORE navigation and holds every
// non-GET request in the browser, unanswered (nothing is handed on, nothing passes through), and
// the transfer target is the synthetic member, whose id is not in the database. The test asserts
// the hold caught exactly ONE transfer POST, which proves the hold saw it.
// The fixture user OWNS the seeded group (the transfer item renders only for the owner), so the
// Leave Group confirm is unreachable here; its focus claim rests on the identical mechanism.
const TRANSFER_PATH = /\/groups\/[^/]+\/transfer-ownership$/;

test.describe('Phase 88.6.1-50 — a pressed Transfer ownership keeps focus at 375px (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'W016 rows 12-13 phone proof — phone project only');

  let hold: WriteHold;

  test.beforeEach(async ({ page }) => {
    // Order matters: the theme init script, then the hold BEFORE any navigation, then the
    // augmentation (registered after the hold, so it runs first on a members GET and every other
    // request falls back into the hold).
    await forceLightMode(page);
    hold = await holdWrites(page);
    await routeAugmentedRoster(page, () => [SYNTH]);
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage).toBeVisible({ timeout: 15_000 });
    await manage.tap();
  });

  // Same reason as the describe above (DECISION Phase 88.6.1-42 wave 5 CI gate): drop this
  // test's routes before fixture teardown closes the page under a running handler.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a pressed Transfer ownership keeps focus and refuses a second press at 375px', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();

    // Copy row G1 at 375px (D-30): the renamed opener fits the header row beside Invite members.
    // About 296px of buttons in a 327px row (a 351px dialog, 12px body padding a side). If the
    // one-row check fails, STOP: the rename wraps the header. Show the owner a 375px screenshot
    // before changing anything, and never shorten the ratified words.
    const reset = dialog.getByRole('button', { name: 'Reset invite link', exact: true });
    const invite = dialog.getByRole('button', { name: 'Invite members', exact: true });
    await expect(reset).toBeVisible();
    await expect(invite).toBeVisible();
    // boundingBox reads the transformed box; the dialog opens with a zoom animation.
    await settleAnimations(dialog);
    const resetBox = await reset.boundingBox();
    const inviteBox = await invite.boundingBox();
    const dialogBox = await dialog.boundingBox();
    if (!resetBox || !inviteBox || !dialogBox) throw new Error('G1 header geometry: a box did not measure');
    const geometry = JSON.stringify({ resetBox, inviteBox, dialogBox });
    expect(resetBox.x, `the reset opener starts inside the dialog (${geometry})`).toBeGreaterThanOrEqual(dialogBox.x);
    expect(resetBox.x + resetBox.width, `the reset opener ends inside the dialog (${geometry})`).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width,
    );
    expect(
      Math.abs(resetBox.y - inviteBox.y),
      `G1: "Reset invite link" shares one row with "Invite members" at 375px (${geometry})`,
    ).toBeLessThanOrEqual(2);
    const header = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(header.scrollWidth, 'G1: the renamed header causes no horizontal page scroll at 375px').toBeLessThanOrEqual(
      header.innerWidth,
    );

    const trigger = dialog.getByRole('button', { name: 'Member actions for E2E Removable' });
    const transferDialog = page.getByRole('dialog', { name: /Transfer ownership to E2E Removable\?/ });
    const openTransfer = async () => {
      await trigger.tap();
      await dialog.getByRole('button', { name: 'Transfer ownership to this member' }).tap();
      await expect(transferDialog).toBeVisible();
    };

    // The stacked Cancel: only the transfer dialog closes, and focus returns to its opener.
    await openTransfer();
    await transferDialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(transferDialog).toHaveCount(0);
    await expect(trigger, 'focus returns to the kebab that opened the transfer dialog').toBeFocused();
    await expect(dialog, 'the roster dialog survives a Cancel in the dialog stacked on it').toBeVisible();

    // The press.
    await openTransfer();
    await transferDialog.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
    // A missing request is a failure, never a skip.
    await expect.poll(() => hold.count('POST', TRANSFER_PATH), { timeout: 15_000 }).toBe(1);

    const pressed = transferDialog.getByRole('button', { name: /^Transferring/ });
    await expect(pressed).toBeFocused();
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');
    await expectGatedPair(page, pressed, 'primary', 'light');
    await expect(transferDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();

    await page.keyboard.press('Enter');
    // An ABSENCE check: there is no positive signal to wait for, so wait a fixed 500ms.
    await page.waitForTimeout(500);
    expect(hold.count('POST', TRANSFER_PATH), 'a second Enter sends no second transfer').toBe(1);
    await expect(pressed).toBeFocused();
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
  });
});
