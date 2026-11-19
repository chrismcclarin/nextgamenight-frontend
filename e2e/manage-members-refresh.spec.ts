import { test, expect, type APIResponse, type Page, type Route } from '@playwright/test';

import { forceLightMode } from './support/contrast';
import {
  expectGatedPair,
  expectNoApiWrites,
  holdWrites,
  settleAnimations,
  type WriteHold,
} from './support/inFlight';
import {
  describeSamples,
  paintedTexts,
  recordLabel,
  recordLabelWhenItAppears,
  spread,
  stopLabelRecorder,
  valuesAt,
} from './support/labelRecorder';
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
    // F9b (88.9-23): the armed item is gated for 3 s; wait for the live label before the
    // committing tap (the 5 s expect timeout covers the gate).
    const confirmRemove = dialog.getByRole('button', { name: 'Tap again to remove' });
    await expect(confirmRemove).toHaveText('Tap again');
    await confirmRemove.tap();

    // POSITIVE signal: the refresh after the removal reached the route and is held.
    await postRemovalArrived;
    expect(deletes, 'the remove sent exactly one DELETE, fulfilled in the browser').toBe(1);
    await expect(dialog.getByText('(You)', { exact: true })).toBeVisible();
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    expect(
      await dialog.getByText('Loading members...').count(),
      'the refresh never puts the first-load line in the roster place',
    ).toBe(0);
    // AMENDED Phase 88.9-67 (X13-7): focus has not moved early. A committed phone Remove keeps
    // its menu open while the remove and its refresh run, so focus is on that item (named Remove,
    // removing), where KebabMenu left it. Before this plan the commit closed the menu and focus
    // sat on the menu's trigger.
    await expect(dialog.getByRole('button', { name: /^Remove ?, removing$/ })).toBeFocused();

    releasePostRemoval();
    await expect(next, "focus lands on the next member's actions button").toBeFocused();
    // 88.9-52 (A-47): Member removed is announced from INSIDE the dialog that is still open.
    // MEASURED 2026-11-16 on the owner's iPhone with VoiceOver, on production: the root
    // announcer's region, which sits outside the open aria-modal dialog, was not spoken. The
    // words now land in the polite region the house Modal mounts as the dialog's last child
    // (src/components/ui/announcer.ts ("DECISION Phase 88.9-52 (A-47): while a house dialog is open")),
    // and the root region stays empty, so exactly one region on the page holds them. Read
    // straight after the refresh: the announcer clears its text 4s after it is written. This
    // proves WHERE the words are in a real browser; whether VoiceOver speaks them is the
    // owner's device check.
    const dialogAnnouncer = dialog.locator('[data-announcer="dialog"]');
    await expect(dialogAnnouncer, 'the open dialog carries exactly one announcer region').toHaveCount(1);
    await expect(dialogAnnouncer, 'Member removed lands in the open dialog').toHaveText('Member removed');
    await expect(dialogAnnouncer).toHaveAttribute('role', 'status');
    await expect(dialogAnnouncer).toHaveAttribute('aria-live', 'polite');
    await expect(
      page.getByRole('status').filter({ hasText: /^Member removed$/ }),
      'one region on the page holds Member removed',
    ).toHaveCount(1);
    await expect(
      page.locator('[data-announcer="root"]'),
      'the root announcer region stays empty while the dialog is open',
    ).toHaveText('');
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

    // AMENDED Phase 88.9-64 (X41, owner at N32, 2026-11-13): the dialog's first paint takes the role
    // the group page already holds (the CI viewer owns this group), and a failure that is neither
    // an access answer nor a gone one keeps it. So with no roster loaded the title is the managing
    // one and the viewer note is absent. Until this plan the title here was the plain one, because
    // the dialog knew no role before its own read answered.
    const dialog = page.getByRole('dialog', { name: 'Manage Group Members', exact: true });
    await expect(dialog.getByText("Couldn't load members")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("You're viewing the member list.")).toHaveCount(0);
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

    // AMENDED Phase 88.9-45 (rule 1): the pressed confirm keeps "Transfer ownership" with the house
    // spinner and is named "Transfer ownership, transferring" (Chromium may insert a space before
    // the sr-only comma) — the Transferring swap word is retired.
    const pressed = transferDialog.getByRole('button', { name: /^Transfer ownership ?, transferring$/ });
    await expect(pressed).toHaveText(/^Transfer ownership/);
    await expect(pressed.locator('[data-slot="spinner"]')).toHaveCount(1);
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

// Plan 88.9-67 (52-X69 widened, owner 2026-11-14: a waiting confirm says Wait, so a person can see
// that pressing is not an option yet). PHONE PROJECT ONLY, like the rest of this file.
// WHAT IT PROVES THAT JSDOM CANNOT: rendered widths. A gated confirm is recorded in the browser
// (e2e/support/labelRecorder.ts) from the moment it appears to its live label, and its width must
// not change on the way.
// WHY IT IS SAFE: holdWrites is registered before navigation and holds every non-GET request in
// the browser; the members are the synthetic rows; each test ends on Cancel or Escape and asserts
// that no write was sent.
test.describe('Phase 88.9-67 — a gated confirm keeps one width at 375px (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'X69 / X67 phone proof — phone project only');

  let hold: WriteHold;
  // The synthetic rows every members read appends. A test that removes one swaps this.
  let extraRows: () => unknown[];

  // Every held write on a member path of the seeded group (the role change is a PUT on
  // .../users/<id>/role and the remove a DELETE on .../users/<id>, src/lib/api.ts).
  const heldMemberWrites = () =>
    hold.held.filter((request) => new URL(request.url).pathname.includes(`/groups/${E2E_GROUP_ID}/users`));

  test.beforeEach(async ({ page }) => {
    extraRows = () => [SYNTH, SYNTH_NEXT];
    hold = await holdWrites(page);
    await routeAugmentedRoster(page, () => extraRows());
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage).toBeVisible({ timeout: 15_000 });
    await manage.tap();
  });

  // Same reason as the first describe (DECISION Phase 88.6.1-42 wave 5 CI gate).
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('X69 (88.9): the Make admin confirm reads Wait (3), (2), (1) then Make admin at one width at 375, named Make admin, wait N seconds while it waits', async ({
    page,
  }) => {
    expect(page.viewportSize()?.width).toBe(375);
    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    await settleAnimations(dialog);

    await dialog.getByRole('button', { name: 'Member actions for E2E Removable' }).tap();
    const makeAdmin = dialog.getByRole('button', { name: 'Make admin', exact: true });
    await expect(makeAdmin).toBeVisible();
    // Installed BEFORE the tap that opens the confirm dialog, so Wait (3) is never missed. The
    // kebab item named Make admin closes in the same commit that opens the dialog; while both
    // exist the recorder takes the later one in the document, which is the stacked dialog's.
    await recordLabelWhenItAppears(page, '[role="dialog"]', /^(Wait \(\d\)|Make admin)$/);
    await makeAdmin.tap();

    const promote = page.getByRole('dialog', { name: /Make E2E Removable an admin\?/ });
    await expect(promote).toBeVisible();
    // The live confirm, after the 3 s gate: named by its content again.
    const confirm = promote.getByRole('button', { name: 'Make admin', exact: true });
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await expect(confirm).not.toHaveAttribute('aria-disabled', 'true');
    const samples = await stopLabelRecorder(page);

    const WAITING = ['Wait (3)', 'Wait (2)', 'Wait (1)'];
    // The first sample is the kebab item (Make admin, in the menu) before the dialog exists.
    const inDialog = samples.slice(samples.findIndex((sample) => sample.text === 'Wait (3)'));
    const trace = describeSamples(inDialog);
    // eslint-disable-next-line no-console -- the measured widths are recorded from the CI log (plan 88.9-67)
    console.log(`[88.9-67 X69 Make admin confirm] phone: ${trace}`);
    expect(paintedTexts(inDialog), `X69: the confirm did not run Wait (3), (2), (1), Make admin (${trace})`).toEqual([
      ...WAITING,
      'Make admin',
    ]);
    expect(valuesAt(inDialog, 'Wait (3)', 'name')).toEqual(['Make admin, wait 3 seconds']);
    expect(valuesAt(inDialog, 'Wait (2)', 'name')).toEqual(['Make admin, wait 2 seconds']);
    expect(valuesAt(inDialog, 'Wait (1)', 'name')).toEqual(['Make admin, wait 1 second']);
    expect(valuesAt(inDialog, 'Make admin', 'name')).toEqual([null]);
    const jump = spread(inDialog, [...WAITING, 'Make admin'], 'width');
    expect(jump, `X69: the confirm changed width by ${jump}px between Wait (3) and Make admin (${trace})`).toBeLessThanOrEqual(0.5);

    await promote.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(promote).toHaveCount(0);
    expect(heldMemberWrites(), 'X69: Cancel sent no member write').toEqual([]);
  });

  // 52-X67 (owner at N50: the armed line wrapped, item 44 -> 56px) and the kebab half of 52-X69.
  // The owner's member menu holds the largest shipped item set (Make admin, Remove, Transfer
  // ownership to this member). Every item must sit on ONE line at 375 (each as tall as the
  // one-word Make admin item), the menu must stay inside the viewport, and the armed Remove must
  // read Wait (3), (2), (1) then Tap again without the item or the menu changing size (R13,
  // 88.9-52: the words it shows are the short ones; it is named Tap again to remove).
  // One tap only: nothing is removed.
  test('X69 + X67 (88.9): the member kebab Remove reads Wait (3), (2), (1) then Tap again, every item on one line at 375 and the menu one width from the arm', async ({
    page,
  }) => {
    expect(page.viewportSize()?.width).toBe(375);
    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    await settleAnimations(dialog);

    await dialog.getByRole('button', { name: 'Member actions for E2E Removable' }).tap();
    const remove = dialog.getByRole('button', { name: 'Remove', exact: true });
    await expect(remove).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Transfer ownership to this member', exact: true })).toBeVisible();

    // One read: every item's label and height, and the menu's box.
    const rest = await remove.evaluate((el) => {
      const list = el.closest('ul');
      if (!list) return null;
      const box = list.getBoundingClientRect();
      const items = Array.from(list.querySelectorAll<HTMLElement>('button'));
      return {
        labels: items.map((item) => item.innerText.trim()),
        heights: items.map((item) => parseFloat(getComputedStyle(item).height)),
        menuLeft: box.left,
        menuRight: box.right,
        menuWidth: parseFloat(getComputedStyle(list).width),
        viewport: window.innerWidth,
      };
    });
    if (!rest) throw new Error('X67: the Remove item is not inside a list');
    const restLine = JSON.stringify(rest);
    // eslint-disable-next-line no-console -- the measured menu is recorded from the CI log (plan 88.9-67)
    console.log(`[88.9-67 X67 member menu at rest] phone: ${restLine}`);
    expect(rest.labels).toEqual(['Make admin', 'Remove', 'Transfer ownership to this member']);
    const oneLine = rest.heights[0];
    // Soft: a wrapped item fails the test, and the armed measures below are still taken and
    // printed, so one red run records both halves.
    for (const [index, height] of rest.heights.entries()) {
      expect.soft(
        Math.abs(height - oneLine),
        `X67: item ${index} is ${height}px tall and the one-word item ${oneLine}px, so it wrapped at 375 (${restLine})`,
      ).toBeLessThanOrEqual(0.5);
    }
    expect.soft(rest.menuLeft, `X67: the menu starts left of the viewport (${restLine})`).toBeGreaterThanOrEqual(0);
    expect.soft(rest.menuRight, `X67: the menu ends right of the viewport (${restLine})`).toBeLessThanOrEqual(rest.viewport);

    await recordLabel(remove);
    await remove.tap();
    // The live label, after the 3 s gate.
    const armed = dialog.getByRole('button', { name: 'Tap again to remove' });
    await expect(armed).toHaveText('Tap again', { timeout: 10_000 });
    const samples = await stopLabelRecorder(page);

    const WAITING = ['Wait (3)', 'Wait (2)', 'Wait (1)'];
    const FROM_THE_ARM = [...WAITING, 'Tap again'];
    const trace = describeSamples(samples);
    // eslint-disable-next-line no-console -- the measured widths are recorded from the CI log (plan 88.9-67)
    console.log(`[88.9-67 X69 kebab Remove] phone: ${trace}`);
    expect(paintedTexts(samples), `X69: the item did not run Remove, Wait (3), (2), (1), Tap again (${trace})`).toEqual([
      'Remove',
      ...FROM_THE_ARM,
    ]);
    expect(valuesAt(samples, 'Wait (3)', 'name')).toEqual(['Remove, wait 3 seconds']);
    expect(valuesAt(samples, 'Wait (2)', 'name')).toEqual(['Remove, wait 2 seconds']);
    expect(valuesAt(samples, 'Wait (1)', 'name')).toEqual(['Remove, wait 1 second']);
    // R13 (88.9-52): live, the item carries its sentence as its name.
    expect(valuesAt(samples, 'Tap again', 'name')).toEqual(['Tap again to remove']);
    // One line through every state: the item never grows past the one-word height.
    const tallest = Math.max(...samples.map((sample) => sample.height));
    expect(tallest - oneLine, `X67: the armed item grew to ${tallest}px from ${oneLine}px, so a label wrapped (${trace})`).toBeLessThanOrEqual(0.5);
    const itemJump = spread(samples, FROM_THE_ARM, 'width');
    expect(itemJump, `X69: the armed item changed width by ${itemJump}px from the arm (${trace})`).toBeLessThanOrEqual(0.5);
    const menuJump = spread(samples, FROM_THE_ARM, 'menuWidth');
    expect(menuJump, `X69: the menu changed width by ${menuJump}px from the arm (${trace})`).toBeLessThanOrEqual(0.5);

    await page.keyboard.press('Escape');
    await expect(armed).toHaveCount(0);
    expect(heldMemberWrites(), 'X69: one tap and Escape sent no member write').toEqual([]);
  });

  // 52-X13 item 7 (owner at N50, frame N50-p1-kebab-commit-held: "nothing on screen shows it is
  // working"). The committing tap on the phone Remove keeps the menu open: the item keeps Remove,
  // shows the house spinner, is aria-disabled, named Remove, removing, and holds focus; the
  // member's other items are aria-disabled too; a further press sends nothing. When the remove
  // lands, focus moves to the next member's actions button.
  // SAFE: the DELETE is for the synthetic member and is ANSWERED IN THE BROWSER ON EVERY PATH by a
  // route registered after the write hold (so it runs first for that one request): a 200 once the
  // test releases it, a 503 if the test ends first. The finally block below settles it and waits
  // for the answer before afterEach removes the routes.
  // AMENDED Phase 88.9-67 (after the red run at 278f50b): the first form of this test parked the
  // DELETE on a promise and answered it only on the passing path. On the old code the test failed
  // first, afterEach removed the routes, and removing interception RESUMES a paused request, so the
  // DELETE went to the CI backend (answered 404 there: the synthetic id has no user row). A request
  // that must never land is answered with route.fulfill, never left paused. Chosen OVER a time
  // limit inside the handler, which only helps when it is shorter than every assertion before it.
  test('X13-7 (88.9): a phone Remove keeps the menu open while it runs — Remove with the spinner, aria-disabled, named Remove, removing, focused — then focus lands on the next member', async ({
    page,
  }) => {
    let removed = false;
    let deletes = 0;
    let settleDelete!: (outcome: 'removed' | 'abandoned') => void;
    const deleteGate = new Promise<'removed' | 'abandoned'>((resolve) => {
      settleDelete = resolve;
    });
    // Every answer the route is still writing; the finally block waits for all of them.
    const answers: Promise<void>[] = [];
    let markDeleteArrived!: () => void;
    const deleteArrived = new Promise<void>((resolve) => {
      markDeleteArrived = resolve;
    });
    extraRows = () => (removed ? [SYNTH_NEXT] : [SYNTH, SYNTH_NEXT]);
    await page.route(isSynthRemove, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      deletes += 1;
      markDeleteArrived();
      const answer = (async () => {
        const outcome = await deleteGate;
        if (outcome === 'removed') {
          removed = true;
          await route.fulfill({ status: 200, json: {} });
          return;
        }
        // The test ended with the remove still held: answer it here so nothing is left paused.
        // The page may already be closing, and a refused answer then has nowhere to land.
        await route.fulfill({ status: 503, json: { error: 'e2e: remove abandoned' } }).catch(() => undefined);
      })();
      answers.push(answer);
      await answer;
    });

    try {
      const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
      const next = dialog.getByRole('button', { name: 'Member actions for E2E Neighbour' });
      await expect(next, 'the fixed neighbour row renders its member-actions button').toBeVisible();
      await settleAnimations(dialog);

      await dialog.getByRole('button', { name: 'Member actions for E2E Removable' }).tap();
      await dialog.getByRole('button', { name: 'Remove', exact: true }).tap();
      const confirmRemove = dialog.getByRole('button', { name: 'Tap again to remove' });
      await expect(confirmRemove).toHaveText('Tap again', { timeout: 10_000 });
      await confirmRemove.tap();

      // POSITIVE signal: the DELETE reached the route and is held there.
      await deleteArrived;
      // The menu is still open and the item shows its flight. Chromium may put a space before the
      // sr-only comma in the name (the same shape as the pressed Transfer ownership above).
      const inFlight = dialog.getByRole('button', { name: /^Remove ?, removing$/ });
      await expect(inFlight, 'X13-7: the committed Remove is gone from the screen while the remove runs').toBeVisible();
      await expect(inFlight).toHaveText(/^Remove/);
      // The house spinner appears after its 200 ms delay; the assertion waits for it.
      await expect(inFlight.locator('[data-slot="spinner"]')).toHaveCount(1);
      await expect(inFlight).toHaveAttribute('aria-disabled', 'true');
      await expect(inFlight).not.toHaveAttribute('disabled');
      await expect(inFlight).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Make admin', exact: true })).toHaveAttribute('aria-disabled', 'true');
      await expect(
        dialog.getByRole('button', { name: 'Transfer ownership to this member', exact: true }),
      ).toHaveAttribute('aria-disabled', 'true');
      await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();

      // A further press on the focused item is refused. An ABSENCE check: there is no positive
      // signal to wait for, so wait a fixed 500ms.
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      expect(deletes, 'X13-7: a press while the remove runs sends no second DELETE').toBe(1);

      settleDelete('removed');
      await expect(next, "X13-7: focus lands on the next member's actions button").toBeFocused({ timeout: 15_000 });
      await expect(dialog.getByText('E2E Removable', { exact: true })).toHaveCount(0);
      expect(deletes, 'still exactly one DELETE').toBe(1);
      expect(heldMemberWrites(), 'X13-7: no other member write was sent').toEqual([]);
    } finally {
      // A no-op after the release above; on any failure it answers the held DELETE in the browser.
      settleDelete('abandoned');
      await Promise.all(answers);
    }
  });

  // G4 (88.9-52 round 4): the after-build capture (r3-m) found the member menu starting 24px off
  // the left of the screen at 200% text with the dialog body scrolled sideways, and its last item
  // cut by the dialog's footer line at every text size. At 375 and 320, at 100% and 200% text:
  // the dialog body does not scroll sideways, the open menu is inside the body's box and the
  // screen from side to side, and every item is whole inside the body, at once where the menu is
  // shorter than the body and after scrolling to it where it is taller. Nothing is tapped in the
  // menu: no member write.
  // AMENDED Phase 88.9-52 (R4 B3; CI run 44381640391 failed this test at 320 with 200% text, the
  // body 275px of content in 270, and the re-shoot found Transfer ownership cut by the footer
  // line at 200% on both widths): the open menu is now WHOLE inside the body at every size, top
  // and bottom too. Where it is taller than the room it has, it scrolls inside itself
  // (src/app/components/KebabMenu.js ("AMENDED Phase 88.9-52 (R4 B3, round 4")): each item is then
  // scrolled to and must be whole inside both the menu and the body, and be the thing under a
  // finger at its centre. Every item is at least 44px tall. The header's close box ends at least
  // 2px (its focus ring) inside the dialog's right edge and starts after the title
  // (src/app/components/Modal.tsx ("AMENDED Phase 88.9-52 (R4 B3, round 4")).
  // SPLIT Phase 88.9-52 (owner 2026-11-18): 320 wide with 200% text is its own test over this one
  // body, so the three sizes that work stay gated while that read is a known failure.
  const memberMenuProof = async (page: Page, arms: ReadonlyArray<readonly ['100%' | '200%', ReadonlyArray<375 | 320>]>) => {
    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    await settleAnimations(dialog);
    const height = page.viewportSize()?.height ?? 667;
    const trigger = dialog.getByRole('button', { name: 'Member actions for E2E Removable' });

    type Box = { left: number; right: number; top: number; bottom: number };
    const readMenu = (el: HTMLElement) => {
      const box = (node: Element): Box => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const list = document.getElementById(el.getAttribute('aria-controls') ?? '');
      let body: HTMLElement | null = el.parentElement;
      while (body && getComputedStyle(body).overflowY === 'visible') body = body.parentElement;
      if (!list || !body) return null;
      const shell = el.closest('[role="dialog"]');
      const close = shell?.querySelector('[data-modal-close]') ?? null;
      const title = shell?.querySelector('h2') ?? null;
      const buttons = Array.from(list.querySelectorAll('button'));
      return {
        menu: box(list),
        menuScrolls: list.scrollHeight - list.clientHeight,
        items: buttons.map(box),
        // Is each item the thing under a finger at its centre?
        onTop: buttons.map((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return Boolean(hit && b.contains(hit));
        }),
        shell: shell ? box(shell) : null,
        close: close ? box(close) : null,
        title: title ? box(title) : null,
        body: box(body),
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyClientHeight: body.clientHeight,
        screen: document.documentElement.clientWidth,
      };
    };
    const inside = (inner: Box, outer: Box) =>
      inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;

    for (const [scale, widths] of arms) {
      if (scale === '200%') {
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await expect
          .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
            message: 'G4: the root font size did not become 32px after the 200% style tag',
          })
          .toBe('32px');
      }
      for (const width of widths) {
        const label = `G4, ${width} wide, ${scale} text`;
        await page.setViewportSize({ width, height });
        await settleAnimations(dialog);
        await trigger.scrollIntoViewIfNeeded();
        await trigger.tap();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(dialog.getByRole('button', { name: 'Transfer ownership to this member', exact: true })).toBeVisible();
        const read = await trigger.evaluate(readMenu);
        if (!read) throw new Error(`${label}: the open menu or the dialog's scrolling body was not found`);
        const line = JSON.stringify(read);
        // eslint-disable-next-line no-console -- the measured menu is recorded from the CI log
        console.log(`[88.9-52 G4 member menu] ${label}: ${line}`);
        expect(read.items, `${label}: the owner's member menu holds three items`).toHaveLength(3);
        expect(read.bodyScrollWidth, `${label}: the dialog body scrolls sideways (${line})`).toBeLessThanOrEqual(read.bodyClientWidth + 1);
        expect(read.menu.left, `${label}: the menu starts left of the dialog body (${line})`).toBeGreaterThanOrEqual(read.body.left - 0.5);
        expect(read.menu.right, `${label}: the menu ends right of the dialog body (${line})`).toBeLessThanOrEqual(read.body.right + 0.5);
        expect(read.menu.left, `${label}: the menu starts left of the screen (${line})`).toBeGreaterThanOrEqual(0);
        expect(read.menu.right, `${label}: the menu ends right of the screen (${line})`).toBeLessThanOrEqual(read.screen + 0.5);
        // R4 B3: the whole menu box is inside the body as it opens, top and bottom too.
        expect(inside(read.menu, read.body), `${label}: the open menu is not whole inside the dialog body (${line})`).toBe(true);
        for (const [index, item] of read.items.entries()) {
          expect(item.bottom - item.top, `${label}: item ${index} is ${item.bottom - item.top}px tall (${line})`).toBeGreaterThanOrEqual(44);
        }
        if (read.menuScrolls <= 1) {
          // The menu fits the room it has: opening it shows every item, with no scroll by hand.
          for (const [index, item] of read.items.entries()) {
            expect(inside(item, read.body), `${label}: item ${index} is not whole inside the dialog body when the menu opens (${line})`).toBe(true);
            expect(read.onTop[index], `${label}: item ${index} is not the thing under a finger at its centre (${line})`).toBe(true);
          }
        } else {
          // Taller than the room it has (large text on a short screen): the menu scrolls inside
          // itself, and every item can be scrolled whole into the menu and the body.
          const list = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
          for (const index of [0, 1, 2]) {
            await list.getByRole('button').nth(index).scrollIntoViewIfNeeded();
            const after = await trigger.evaluate(readMenu);
            if (!after) throw new Error(`${label}: the menu closed while scrolling to item ${index}`);
            const afterLine = JSON.stringify(after);
            expect(inside(after.menu, after.body), `${label}: the menu left the dialog body while scrolling to item ${index} (${afterLine})`).toBe(true);
            expect(inside(after.items[index], after.menu), `${label}: item ${index} cannot be scrolled whole into the menu (${afterLine})`).toBe(true);
            expect(inside(after.items[index], after.body), `${label}: item ${index} cannot be scrolled whole into the dialog body (${afterLine})`).toBe(true);
            expect(after.onTop[index], `${label}: item ${index}, scrolled to, is not the thing under a finger at its centre (${afterLine})`).toBe(true);
          }
        }
        // R4 B3: the header's close box, with its 2px focus ring, ends inside the dialog and starts after the title.
        if (!read.shell || !read.close || !read.title) throw new Error(`${label}: the dialog, its close button or its title was not found`);
        expect(read.close.right + 2, `${label}: the close button's focus box ends past the dialog's right edge (${line})`).toBeLessThanOrEqual(read.shell.right + 0.5);
        expect(read.close.left, `${label}: the close button starts over the title (${line})`).toBeGreaterThanOrEqual(read.title.right - 0.5);
        expect(read.close.right - read.close.left, `${label}: the close button is ${read.close.right - read.close.left}px wide`).toBeGreaterThanOrEqual(44);
        // Closed from its trigger (a tap does not focus the item on WebKit, so no Escape here).
        await trigger.scrollIntoViewIfNeeded();
        await trigger.tap();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      }
    }
    expect(heldMemberWrites(), 'G4: opening and closing the menu sent no member write').toEqual([]);
  };

  test('G4 (88.9-52): the member menu is whole inside the dialog at 375 and 320 at 100% text, and at 375 at 200% text', async ({ page }) => {
    await memberMenuProof(page, [['100%', [375, 320]], ['200%', [375]]]);
  });

  test('G4 at 320 wide with 200% text (88.9-52): the member menu is inside the dialog and every item can be reached', async ({ page }) => {
    // DECISION Phase 88.9-52 (owner 2026-11-18): this 320 wide / 200% text read is marked as an
    // expected failure, kept running, over skipping it, deleting it or patching the screen. The
    // fix / see / fix rule stopped screen-by-screen patching at this size; Phase 89.6 researches
    // the large-text method and owns this read. When the screen is fixed this test reports an
    // unexpected pass: remove the test.fail line then. Removing it earlier is a decision, not a cleanup.
    test.fail(true, 'Known failure at 320 wide with 200% text, owned by Phase 89.6 (planning:.planning/deferred/phase-89.6.md, heading Found by the final picture pass (R5) and by CI at FE 06c2db4)');
    await memberMenuProof(page, [['200%', [320]]]);
  });
});
