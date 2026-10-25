import { test, expect, type Locator, type Page } from '@playwright/test';
import { settleAnimations } from './support/inFlight';

/**
 * Phase 88.6.1-32 — the Browse Games dialog at 375px (AC-27's Browse Games half, D-41, AC-13).
 *
 * WHAT THIS ASSERTS THAT jsdom CANNOT. `src/app/components/BrowseMoreModal.test.tsx` pins the
 * refresh-in-place state machine (same card nodes, aria-busy on the list, copy row E8 in the
 * polite slot region, latest wins, the failure line in the assertive one) and the decrement's
 * attributes. jsdom performs no layout and never blurs a disabled element, so it cannot see the
 * three things this file measures in a real engine at the iPhone SE viewport: (1) the dialog's
 * HEIGHT does not change when a refresh starts (the reserved one-line slot in the sticky
 * toolbar is what holds it), (2) a failed refresh keeps the cards and its failure line fits
 * inside the dialog without a horizontal scroll, and (3) a real browser leaves focus on the
 * "Decrease player count" button when Enter takes it to its limit of 1.
 *
 * NOT RUN LOCALLY — the e2e typecheck and the phone listing are the only local proof. The
 * `phone` project depends on the `setup` project, which signs in through Auth0 with
 * credentials that are deliberately absent on a developer machine. CI's `e2e` job runs it in
 * the `phone` project on the phase PR.
 *
 * Each test's RED half holds by construction on the pre-88.6.1-32 tree and is not separately
 * demonstrated here: there the grid was swapped for the one-line loading paragraph on every
 * refresh (the dialog shrinks, test 1), the fetch catch cleared the cards (test 2), and the
 * decrement carried the native disabled attribute (focus leaves it at 1, test 3).
 *
 * DECISION Phase 88.6.1-32 (fixture): the suggestions response is supplied by `page.route`,
 * chosen OVER the seeded collections (reachable, but uncontrolled — e2e/touch-targets.spec.ts ("MEASURED, not assumed: those steppers are UNREACHABLE in CI."),
 * `CORRECTED 2026-09-28` — a real list could reach the dialog's 90dvh cap and make the height
 * comparison vacuous, and a held or failing response needs interception anyway) and OVER a
 * backend fixture (a cross-repo change, out of this plan's scope). Both games are synthetic and
 * carry no thumbnail. The route intercepts GET requests to the group-suggestions endpoint only.
 * Replacing the route with real data is a decision, not a cleanup.
 *
 * Selector policy: role, label and text locators plus the two test ids, never a Tailwind class;
 * DOM reads go through `evaluate` on located elements. No screenshots, and no environment value
 * is printed.
 */

// Repo idiom (event-scheduler-touch.spec.ts, DECISION Phase 88.1-21): no fallback group id —
// a job that failed to export the fixture id fails loudly below instead of driving group '1'.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';
const FIXTURE_OWNER = 'periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js';

test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this file opens Create Event for a group the fixtures do not own.',
  ).toBeTruthy();
});

// Copy row E8 (U+2026) and the first-load line, as the dialog renders them.
const UPDATING = 'Updating suggestions…';
const FIRST_LOAD = 'Loading suggestions...';
const LIBRARY_EMPTY = "Your group hasn't added any games to its collections yet.";
const FILTERS_EMPTY = 'No games match these filters. Try widening your selection.';

const GAME_ALPHA = {
  id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'E2E Browse Alpha',
  thumbnail_url: null,
  min_players: 2,
  max_players: 5,
  playing_time: 45,
  weight: 1.9,
  owners: [] as string[],
  avg_group_rating: null,
  review_count: 0,
};
const GAME_BETA = {
  id: '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
  name: 'E2E Browse Beta',
  thumbnail_url: null,
  min_players: 1,
  max_players: 4,
  playing_time: 30,
  weight: 2.6,
  owners: [] as string[],
  avg_group_rating: null,
  review_count: 0,
};

type RouteMode = 'ok' | 'hold' | 'fail';
type SuggestionsRoute = {
  ok: () => void;
  hold: () => void;
  fail: () => void;
  release: () => void;
};

/** Install BEFORE `page.goto`. `ok` fulfils both games; `hold` waits for `release()` and then
 *  fulfils the same; `fail` aborts the request (a transport failure). Non-GET continues. */
async function installSuggestionsRoute(page: Page): Promise<SuggestionsRoute> {
  let mode: RouteMode = 'ok';
  let openGate: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  await page.route(
    (url) => url.pathname.startsWith('/api/suggestions/group/'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const current = mode;
      if (current === 'fail') {
        await route.abort('failed');
        return;
      }
      if (current === 'hold') await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [GAME_ALPHA, GAME_BETA] }),
      });
    },
  );
  return {
    ok: () => {
      mode = 'ok';
    },
    hold: () => {
      mode = 'hold';
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    },
    fail: () => {
      mode = 'fail';
    },
    release: () => {
      mode = 'ok';
      openGate();
    },
  };
}

/** A zero-count locator makes every assertion after it vacuous — fail loudly AT THE LOCATOR
 *  (the guardResolved contract of event-scheduler-touch.spec.ts). */
async function guardResolved(locator: Locator, what: string): Promise<void> {
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a zero-count locator makes every assertion after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the dialog`,
  ).toBeVisible({ timeout: 15_000 });
}

const browseDialog = (page: Page) => page.getByRole('dialog', { name: 'Browse games' });

/** Group home → Create Event → QuickSuggestions' "Browse more" → the Browse Games dialog,
 *  settled: its first card is visible and every running animation in it has finished. */
async function openBrowseGames(page: Page): Promise<Locator> {
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
  const browseMore = page
    .getByTestId('quick-suggestions-slot')
    .getByRole('button', { name: 'Browse more' });
  await guardResolved(
    browseMore,
    `"Browse more" — it renders only once the suggestions request (served by this file's route) returns chips, and that request fires only when the fixture group has at least one member (owner: ${FIXTURE_OWNER})`,
  );
  await browseMore.click();
  const browse = browseDialog(page);
  await expect(browse).toBeVisible();
  await expect(browse.getByRole('button', { name: GAME_ALPHA.name })).toBeVisible();
  // Wave 9 gate (orchestrator-routed 2026-10-17, CI run 39026336968): the inline wait here awaited
  // every animation's `finished` bare, and a CANCELLED animation rejects it with AbortError ("The
  // user aborted a request." at this line, the failed-refresh arm's first attempt). The shared
  // settleAnimations counts a cancelled animation as done and skips infinite ones (a spinner), so
  // the dialog is still measured only once nothing in it is moving.
  await settleAnimations(browse);
  return browse;
}

async function boxHeight(locator: Locator, what: string): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, `${what} has no layout box`).not.toBeNull();
  return box!.height;
}

test.describe('Browse Games dialog at 375px (88.6.1-32)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone project only (375px): the busy-start height and the decrement focus are phone-first claims');

  test('Browse Games modal at 375px — the dialog height does not change when a refresh starts (88.6.1-32, AC-27)', async ({ page }) => {
    const route = await installSuggestionsRoute(page);
    try {
      const browse = await openBrowseGames(page);
      const settled = await boxHeight(browse, 'the settled Browse Games dialog');
      const viewport = page.viewportSize();
      expect(viewport, 'the page has no viewport size').not.toBeNull();
      // Anti-vacuity: a dialog already at its 90dvh cap cannot shrink or grow, so the
      // comparison below would pass on any tree.
      expect(
        settled,
        `the settled dialog (${settled}px) is at or near its 90dvh cap (${viewport!.height * 0.9}px) — the height comparison would be vacuous; the fixture list must stay short`,
      ).toBeLessThan(viewport!.height * 0.9 - 2);

      route.hold();
      await browse.getByRole('button', { name: 'Increase player count' }).click();
      // Either busy signal, so a tree that swaps the grid for the first-load line fails on the
      // HEIGHT below rather than on a timeout here.
      await expect(
        browse
          .getByText(UPDATING, { exact: true })
          .or(browse.getByText(FIRST_LOAD, { exact: true }))
          .first(),
      ).toBeVisible();
      const busy = await boxHeight(browse, 'the Browse Games dialog at busy start');
      expect(
        Math.abs(busy - settled),
        `the dialog moved when the refresh started: settled ${settled}px, busy ${busy}px`,
      ).toBeLessThanOrEqual(1);

      const status = browse.getByTestId('browse-more-status').getByRole('status');
      await expect(status).toHaveText(UPDATING);
      await expect(browse.getByRole('button', { name: GAME_ALPHA.name })).toBeVisible();
      await expect(browse.getByTestId('browse-more-results')).toHaveAttribute('aria-busy', 'true');

      route.release();
      await expect(status).toHaveText('');
    } finally {
      route.release();
    }
  });

  test('Browse Games modal at 375px — a failed refresh keeps the cards and its failure line fits (88.6.1-32, D-41)', async ({ page }) => {
    const route = await installSuggestionsRoute(page);
    try {
      const browse = await openBrowseGames(page);
      route.fail();
      // Wave 9 gate: a positive signal that the refresh REQUEST happened (the route aborts it), so
      // the assertions below read the failed state, not the moment before the request left.
      const failedRefresh = page.waitForRequest(
        (req) => req.method() === 'GET' && new URL(req.url()).pathname.startsWith('/api/suggestions/group/'),
      );
      await browse
        .getByRole('group', { name: 'Complexity' })
        .getByRole('button', { name: 'Light', exact: true })
        .click();
      await failedRefresh;
      const alertRegion = browse.getByTestId('browse-more-status').getByRole('alert');
      await expect(alertRegion).toHaveText(/\S/);
      await expect(browse.getByTestId('browse-more-results')).not.toHaveAttribute('aria-busy', 'true');
      await settleAnimations(browse);

      await expect(browse.getByRole('button', { name: GAME_ALPHA.name })).toBeVisible();
      await expect(browse.getByText(FIRST_LOAD, { exact: true })).toHaveCount(0);
      await expect(browse.getByText(LIBRARY_EMPTY, { exact: true })).toHaveCount(0);
      await expect(browse.getByText(FILTERS_EMPTY, { exact: true })).toHaveCount(0);

      const alertBox = await alertRegion.boundingBox();
      const dialogBox = await browse.boundingBox();
      expect(alertBox, 'the slot alert region has no layout box').not.toBeNull();
      expect(dialogBox, 'the Browse Games dialog has no layout box').not.toBeNull();
      expect(
        alertBox!.x + alertBox!.width,
        'the failure line runs past the dialog right edge at 375px',
      ).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 0.5);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        overflow.scrollWidth,
        `the page scrolls horizontally: scrollWidth ${overflow.scrollWidth}px, innerWidth ${overflow.innerWidth}px`,
      ).toBeLessThanOrEqual(overflow.innerWidth);
    } finally {
      route.release();
    }
  });

  test('Browse Games modal at 375px — the decrease button keeps focus when it reaches 1 (88.6.1-32, AC-13)', async ({ page }) => {
    const route = await installSuggestionsRoute(page);
    try {
      const browse = await openBrowseGames(page);
      const box = browse.getByRole('spinbutton', { name: 'Player count' });
      // A box that already reads 2 fires no request, so only wait for one when the value moves.
      if ((await box.inputValue()) !== '2') {
        const atTwo = page.waitForResponse(
          (res) =>
            res.url().includes('/api/suggestions/group/') &&
            new URL(res.url()).searchParams.get('playerCount') === '2',
        );
        await box.fill('2');
        await atTwo;
      }
      await expect(box).toHaveValue('2');

      const decrement = browse.getByRole('button', { name: 'Decrease player count' });
      await decrement.focus();
      await page.keyboard.press('Enter');
      await expect(box).toHaveValue('1');
      await expect(decrement).toBeFocused();
      await expect(decrement).toHaveAttribute('aria-disabled', 'true');
      await expect(decrement).not.toHaveAttribute('disabled');

      await page.keyboard.press('Enter');
      await expect(box).toHaveValue('1');
      await expect(decrement).toBeFocused();
    } finally {
      route.release();
    }
  });
});
