// OW-2 (89.6-04) — the inline two-tap confirm in a real browser, in BOTH projects (phone at
// 375 x 667 and journeys).
//
// WHAT. Owner ruling OW-2 A (2026-11-22): an armed tap-again control has no time limit. It stays
// live until the second press or until it disarms. Test 1 arms a Friends Remove and reads it again
// 8 seconds later (the old revert came 6 seconds after the arm). Phase 89.6-04 Task 2 adds the
// scroll-out-of-view case here, and plan 89.6-07 the kebab case.
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
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

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
});
