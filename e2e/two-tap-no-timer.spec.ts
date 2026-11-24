// OW-2 (89.6-04) — the inline two-tap confirm in a real browser, in BOTH projects (phone at
// 375 x 667 and journeys).
//
// WHAT. Owner ruling OW-2 A (2026-11-22): an armed tap-again control has no time limit. It stays
// live until the second press or until it disarms. Test 1 arms a Friends Remove and reads it again
// 8 seconds later (the old revert came 6 seconds after the arm). Test 2 arms it, scrolls it fully
// out of view and reads the disarm (owner, the same evening). Plan 89.6-07 adds the kebab case.
//
// KEBAB (89.6-07): OW-2a Keep. A member Remove in Manage Members stays armed after 8 s and while
// focus moves between the items of its menu; closing the menu is what disarms it. Real seeded
// roster read with GET (the seed is the fixture layer: Weekend Warriors has three non-owner
// members); never a second press; the viewport is set before goto in both projects because the
// member menu is the phone layout (md:hidden); no conditional skip, so both tests run in both
// projects and each raises both rows in scripts/gate-c-floors.manifest.mjs.
//
// WRITE GUARD. holdWrites is registered FIRST, before any route and before the navigation, and
// holds every non-GET on every URL (the backend and the BFF proxy alike). Both friend lists are
// answered in the browser. The self read loses its timezone parameter before it reaches the
// network, so the backend's time zone backfill cannot run. The register's other writing GETs (a
// path ending /invite-token, /rsvp/respond or /prompt-settings) are answered in the browser and
// counted: writing GETs are answered, never held. No test here presses an armed control a second
// time. The afterEach never calls unrouteAll: turning interception off resumes the requests the
// hold is holding (the 88.9-03 leak, where a held PATCH changed the CI user's time zone).
//
// WHERE. Both projects, with no conditional skip. Its rows in scripts/gate-c-floors.manifest.mjs
// exist so a green CI run prints one line per project naming this spec (CI prints nothing per
// passing test), and they move in the commit that adds a test.
//
// CI ONLY. Both projects need the .auth storage state, which does not exist locally. The jsdom
// pins in src/components/ui/useConfirmAction.test.ts and src/app/friends/page.test.tsx are the
// RED halves.
//
// The route matchers are inline one-line URL predicates on the same API as
// e2e/friends-page.spec.ts ("const isFriendshipList"): that file's helpers are spec-local and a
// spec file cannot be imported by another. If a third spec needs them, lifting both into
// e2e/support/ is that plan's first step. Selectors are role, name or data attribute only, never
// Tailwind classes. Assertion messages carry numbers only, never personal data.
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI. No fallback id (the
// e2e/manage-members-refresh.spec.ts ("const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';")
// idiom): a fallback would open a group the fixtures do not own. Never printed: the failure
// message names the variable, not its value.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

// 20 routed friends: enough rows that the first one can scroll fully out of view at 320 x 568.
const FRIENDS = Array.from({ length: 20 }, (_, index) => {
  const nn = String(index + 1).padStart(2, '0');
  return {
    id: `e2e-two-tap-f${nn}`,
    friend: { id: `89604000-0000-4000-8000-0000000000${nn}`, username: `E2E Two Tap ${nn}` },
  };
});
const FIRST = FRIENDS[0];

// The shape of src/lib/schemas/prompts.ts ("export const EMPTY_PROMPT_SETTINGS: PromptSettings = {").
const EMPTY_PROMPT_SETTINGS = { id: null, schedules: [], games: [], members: [] };

const isFriendshipList = (url: URL, key: 'status' | 'direction', value: string) =>
  url.pathname.endsWith('/friendships') && url.searchParams.get(key) === value;
const isSelfReadWithTimezone = (url: URL) =>
  /\/users\/[^/]+$/.test(url.pathname) && url.searchParams.has('timezone');
const isWritingGet = (url: URL) =>
  url.pathname.endsWith('/invite-token') ||
  url.pathname.endsWith('/rsvp/respond') ||
  url.pathname.endsWith('/prompt-settings');

// A GET-only handler: every other method goes back to the hold, which keeps it in the browser.
function onGet(handler: (route: Route) => Promise<void>) {
  return async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await handler(route);
  };
}

function firstRow(page: Page): Locator {
  return page.locator(`[data-friend-row="${FIRST.id}"]`);
}

// The first row's Remove in each of its three states: at rest, waiting, live.
function firstRemove(page: Page): Locator {
  return firstRow(page).getByRole('button', {
    name: /^(Remove E2E Two Tap 01(, wait \d seconds?)?|Tap again to confirm)$/,
  });
}

// OW-2a (89.6-07): the shared start of the two kebab tests. Opens the seeded group's Manage
// Members dialog at a phone size, opens the first member menu and arms its Remove (ONE press).
// Returns once the item is live.
async function armFirstMemberRemove(page: Page, viewport: { width: number; height: number }) {
  expect(E2E_GROUP_ID, 'E2E_GROUP_ID must be set by the CI fixture step').toBeTruthy();
  // BEFORE the navigation, in both projects: journeys is a desktop size, and the member menu
  // exists only in the phone layout.
  await page.setViewportSize(viewport);
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  expect(page.viewportSize()?.width).toBe(viewport.width);

  const manage = page.getByRole('button', { name: 'Manage Members' });
  await expect(manage, 'OW-2a: the group page never rendered Manage Members').toBeVisible({ timeout: 15_000 });
  await manage.click();
  const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await settleAnimations(dialog);

  const triggers = dialog.getByRole('button', { name: /^Member actions for / });
  await expect
    .poll(() => triggers.count(), {
      message: 'the seeded group has no other member: fix the seed, scripts/seed-sample-data.js',
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);
  const trigger = triggers.first();
  await trigger.click();
  // The open list, through the trigger's own aria-controls, so every item below is this menu's.
  const listId = await trigger.getAttribute('aria-controls');
  expect(listId, 'OW-2a: the open member menu names no list').toBeTruthy();
  const menu = dialog.locator(`[id="${listId}"]`);

  await menu.getByRole('button', { name: 'Remove', exact: true }).click();
  // Live after the 3 s wait: it shows Tap again and is named by its sentence.
  const armed = menu.getByRole('button', { name: 'Tap again to remove', exact: true });
  await expect(armed).toHaveText('Tap again', { timeout: 10_000 });
  return { dialog, trigger, menu, armed };
}

test.describe('the inline two-tap confirm has no time limit (OW-2, 89.6-04)', () => {
  let hold: WriteHold | undefined;
  // Every writing GET the page sent, by URL. No page these tests visit has a reason to send one.
  let writingGets: string[] = [];

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any route and before navigation, so it is the last resort.
    hold = await holdWrites(page);
    writingGets = [];
    await page.route(
      (url) => isFriendshipList(url, 'status', 'accepted'),
      onGet((route) => route.fulfill({ status: 200, json: FRIENDS })),
    );
    await page.route(
      (url) => isFriendshipList(url, 'direction', 'received'),
      onGet((route) => route.fulfill({ status: 200, json: [] })),
    );
    await page.route(
      isSelfReadWithTimezone,
      onGet(async (route) => {
        const url = new URL(route.request().url());
        url.searchParams.delete('timezone');
        await route.continue({ url: url.toString() });
      }),
    );
    await page.route(
      isWritingGet,
      onGet(async (route) => {
        const url = new URL(route.request().url());
        writingGets.push(url.toString());
        if (url.pathname.endsWith('/prompt-settings')) {
          await route.fulfill({ status: 200, json: EMPTY_PROMPT_SETTINGS });
          return;
        }
        // A stray caller fails visibly instead of writing.
        await route.fulfill({ status: 418, json: {} });
      }),
    );
  });

  test.afterEach(() => {
    expectNoApiWrites(hold);
    expect(
      writingGets,
      `a GET that writes was sent ${writingGets.length} time(s): ${writingGets.join(', ')}`,
    ).toEqual([]);
    hold = undefined;
  });

  test('OW-2 (89.6-04): an armed friend Remove still reads Tap again after 8 seconds', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/friends');
    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }

    const remove = firstRemove(page);
    await expect(firstRow(page), 'OW-2: the routed friend row never rendered').toBeVisible({ timeout: 15_000 });
    await expect(remove, 'OW-2: the routed friend row never rendered its Remove').toBeVisible({ timeout: 15_000 });
    await remove.scrollIntoViewIfNeeded();
    await remove.click();
    // Live after the 3 s wait.
    await expect(remove).toHaveAccessibleName('Tap again to confirm', { timeout: 10_000 });

    // 8 seconds on, with nothing pressed: the old window ended 3 seconds after the live edge.
    // The fixed wait IS the test: no timer may end the armed state.
    await page.waitForTimeout(8_000);
    await expect(remove, 'OW-2: the armed Remove reverted on its own').toHaveAccessibleName('Tap again to confirm');
    await expect(remove).toHaveAttribute('aria-pressed', 'true');
  });

  // Owner, 2026-11-22: the scroll-out-of-view disarm is built. The phone project runs this one at
  // 320 x 568 (test 1 covers 375); journeys runs it at its own desktop size.
  test('OW-2 (89.6-04): an armed friend Remove scrolled out of view disarms and says Confirmation cancelled.', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    if (testInfo.project.name === 'phone') {
      // BEFORE the navigation, so the page lays out at 320 from its first paint.
      await page.setViewportSize({ width: 320, height: 568 });
    }
    await page.goto('/friends');
    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(320);
    }

    const remove = firstRemove(page);
    await expect(remove, 'OW-2: the routed friend row never rendered its Remove').toBeVisible({ timeout: 15_000 });
    await remove.scrollIntoViewIfNeeded();
    await remove.click();
    await expect(remove).toHaveAccessibleName('Tap again to confirm', { timeout: 10_000 });

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const box = await remove.boundingBox();
    expect(box, 'OW-2: the first Remove has no layout box').not.toBeNull();
    const bottom = Math.round((box?.y ?? 0) + (box?.height ?? 0));
    expect(
      bottom,
      `the page is too short to scroll the first Remove out of view: route more friends (its bottom edge is at ${bottom}px)`,
    ).toBeLessThanOrEqual(0);

    // Straight after the scroll: the words clear 4 s after the disarm (INLINE_RECEIPT_MS).
    await expect(
      page.getByRole('status').filter({ hasText: /^Confirmation cancelled\.$/ }),
      'OW-2: no status region said the disarm',
    ).toHaveCount(1);
    await expect(remove).toHaveAccessibleName('Remove E2E Two Tap 01');
    await expect(remove).not.toHaveAttribute('aria-pressed', 'true');
  });

  // OW-2a (89.6-07): the kebab half. Both tests run in both projects at a phone size and press an
  // armed item ONCE; the afterEach above proves nothing left the browser.
  test('OW-2a (89.6-07): an armed Manage Members Remove still reads Tap again after 8 seconds, also while focus moves to the item above it and back (375 x 667)', async ({ page }) => {
    test.setTimeout(60_000);
    const { trigger, menu, armed } = await armFirstMemberRemove(page, { width: 375, height: 667 });

    // 8 seconds on, with nothing pressed: the old revert came 3 seconds after the live edge.
    // The fixed wait IS the test: no timer may end the armed state.
    await page.waitForTimeout(8_000);
    await expect(armed, 'OW-2a: the armed Remove reverted on its own').toHaveText('Tap again');
    await expect(armed).toHaveAttribute('aria-pressed', 'true');

    // Focus moves to the item above and back: both moves stay inside the open menu.
    await armed.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(menu.getByRole('button', { name: /^Make (admin|member)$/ })).toBeFocused();
    await expect(armed, 'OW-2a: moving focus to the item above disarmed the Remove').toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(armed).toBeFocused();
    await expect(armed).toHaveAccessibleName('Tap again to remove');
    await expect(armed).toHaveAttribute('aria-pressed', 'true');

    // Close the menu by its trigger: nothing is left armed.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('OW-2a (89.6-07): closing the menu after 8 seconds disarms the armed Manage Members Remove and says Confirmation cancelled. (320 x 568)', async ({ page }) => {
    test.setTimeout(60_000);
    const { dialog, trigger, menu, armed } = await armFirstMemberRemove(page, { width: 320, height: 568 });

    await page.waitForTimeout(8_000);
    await expect(armed, 'OW-2a: the armed Remove reverted on its own').toHaveText('Tap again');

    // A press outside the menu, inside the dialog: the menu closes, and the close says the words.
    await dialog.getByRole('heading', { name: 'Manage Group Members' }).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByRole('status').filter({ hasText: /^Confirmation cancelled\.$/ }),
      'OW-2a: no status region said the disarm',
    ).toHaveCount(1);

    // Reopened, the item is at rest.
    await trigger.click();
    const remove = menu.getByRole('button', { name: 'Remove', exact: true });
    await expect(remove).toBeVisible();
    await expect(remove).not.toHaveAttribute('aria-pressed');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
