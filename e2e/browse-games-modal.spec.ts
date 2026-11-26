import { test, expect, type Locator, type Page } from '@playwright/test';
import { assertTheme, forceLightMode, inkRatioThroughOpacity } from './support/contrast';
import { settleAnimations } from './support/inFlight';

/**
 * Phase 88.6.1-32 — the Browse Games dialog at 375px (AC-27's Browse Games half, D-41, AC-13).
 *
 * WHAT THIS ASSERTS THAT jsdom CANNOT. src/app/components/BrowseMoreModal.test.tsx pins the
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
  // D15b (plan 88.9-21): a rating so the card renders its rating line for the DEC-2 read. Safe:
  // every other read of ALPHA is by its button name, which comes from the title alone.
  avg_group_rating: 4.2,
  review_count: 3,
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
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
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

  // 88.9-52 R4 C2 (accessibility once-over A3, owner 2026-11-18), RENDERED. The two steppers were
  // 32 by 32, 4px apart; they are 44 by 44 squares now (w-11 h-11 on a raw .btn, no opt-out
  // class). Three widths of the same open dialog: 375 at ordinary text (the square, the order
  // and the 4px gaps), 320 at ordinary text (still one line, inside the toolbar: 44 + 4 + 64 +
  // 4 + 44 of 264px), and 320 with text at 200% (the squares are 88px because every length is
  // rem; the three controls cannot share 208px, so the group wraps and nothing leaves the
  // toolbar). 200% is the root font size doubled by a style tag
  // (e2e/month-nav-row.spec.ts ("HOW 200% IS PRODUCED.")), not browser zoom. Read-only: nothing is
  // clicked after the dialog opens, and the suggestions response is this file's route.
  // RED on the tree before R4 C2: the first size assertion reads 32.
  // AMENDED Phase 89.6-18 (O-M4 Fixed+, owner pick 2026-11-22: 'The box stays 44px, and the icon
  // inside grows with the text up to 32px'): the 88px squares above are history. At 320 / 200% the
  // steppers hold 44 by 44 with their glyphs capped at 32px, the minus, the 128px box and the plus
  // share one line (44 + 8 + 128 + 8 + 44 = 232 of 264px), and every toolbar control stays inside
  // the toolbar. The 375 arm also reads the count box at 44px or more (S1, owner "Fix").
  // SPLIT Phase 88.9-52 (owner 2026-11-18): the ordinary-text reads and the 320 / 200% read are two
  // tests over this one body, so the sizes that work stay gated while the 200% read is a known failure.
  const stepperRowProof = async (page: Page, large: boolean) => {
    const route = await installSuggestionsRoute(page);
    try {
      const browse = await openBrowseGames(page);
      const controls = browse.getByTestId('browse-more-controls');
      const decrement = browse.getByRole('button', { name: 'Decrease player count' });
      const increment = browse.getByRole('button', { name: 'Increase player count' });
      const count = browse.getByRole('spinbutton', { name: 'Player count' });
      await guardResolved(decrement, 'the "Decrease player count" stepper');
      await guardResolved(increment, 'the "Increase player count" stepper');
      const rect = async (locator: Locator, what: string) => {
        const box = await locator.boundingBox();
        expect(box, `${what} has no layout box`).not.toBeNull();
        return { left: box!.x, right: box!.x + box!.width, top: box!.y, width: box!.width, height: box!.height };
      };
      const readRow = async () => ({
        dec: await rect(decrement, 'the decrease stepper'),
        inc: await rect(increment, 'the increase stepper'),
        box: await rect(count, 'the player-count box'),
        bar: await rect(controls, 'the filter toolbar'),
        barOverflow: await controls.evaluate((el) => el.scrollWidth - el.clientWidth),
      });
      const expectSquare = (r: { width: number; height: number }, side: number, what: string) => {
        expect(Math.abs(r.width - side), `R4 C2: ${what} is ${r.width}px wide, expected ${side}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(r.height - side), `R4 C2: ${what} is ${r.height}px tall, expected ${side}`).toBeLessThanOrEqual(0.5);
      };
      const expectInsideBar = (row: Awaited<ReturnType<typeof readRow>>, at: string) => {
        for (const [name, r] of [['the decrease stepper', row.dec], ['the player-count box', row.box], ['the increase stepper', row.inc]] as const) {
          expect(r.left, `R4 C2 (${at}): ${name} starts ${row.bar.left - r.left}px left of the toolbar`).toBeGreaterThanOrEqual(row.bar.left - 0.5);
          expect(r.right, `R4 C2 (${at}): ${name} ends ${r.right - row.bar.right}px past the toolbar's right edge`).toBeLessThanOrEqual(row.bar.right + 0.5);
        }
        expect(row.barOverflow, `R4 C2 (${at}): the toolbar scrolls sideways by ${row.barOverflow}px`).toBeLessThanOrEqual(1);
      };

      if (!large) {
        // 375, ordinary text.
        const phone = await readRow();
        expectSquare(phone.dec, 44, 'the decrease stepper at 375');
        expectSquare(phone.inc, 44, 'the increase stepper at 375');
        expect(Math.abs(phone.dec.top - phone.inc.top), 'R4 C2: at 375 the two steppers are not on one line').toBeLessThanOrEqual(1);
        expect(Math.abs(phone.box.left - phone.dec.right - 4), `R4 C2: at 375 the box starts ${phone.box.left - phone.dec.right}px after the decrease stepper, expected 4`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(phone.inc.left - phone.box.right - 4), `R4 C2: at 375 the increase stepper starts ${phone.inc.left - phone.box.right}px after the box, expected 4`).toBeLessThanOrEqual(0.5);
        // S1 (owner "Fix", first look 2026-11-22; 89.6-18): the count box meets the 44px floor (34px before).
        expect(phone.box.height, `S1: at 375 the player-count box is ${phone.box.height}px tall, under 44`).toBeGreaterThanOrEqual(43.5);
        expectInsideBar(phone, '375');
      }

      // 320, ordinary text: still one line, inside the toolbar.
      const viewport = page.viewportSize();
      expect(viewport, 'the page has no viewport size').not.toBeNull();
      await page.setViewportSize({ width: 320, height: viewport!.height });
      await expect.poll(async () => (await rect(controls, 'the filter toolbar')).width, { message: 'R4 C2: the toolbar did not narrow at 320px' }).toBeLessThan(300);
      if (!large) {
        const narrow = await readRow();
        expectSquare(narrow.dec, 44, 'the decrease stepper at 320');
        expectSquare(narrow.inc, 44, 'the increase stepper at 320');
        expect(Math.abs(narrow.dec.top - narrow.inc.top), 'R4 C2: at 320 and ordinary text the count row wrapped').toBeLessThanOrEqual(1);
        expect(narrow.dec.right, 'R4 C2: at 320 the box is not between the steppers').toBeLessThanOrEqual(narrow.box.left + 0.5);
        expect(narrow.box.right, 'R4 C2: at 320 the box is not between the steppers').toBeLessThanOrEqual(narrow.inc.left + 0.5);
        expectInsideBar(narrow, '320');
        return;
      }

      // 320 with text at 200% (O-M4 Fixed+, 89.6-18): the steppers hold 44 by 44 and their glyphs stop
      // at 32px, the minus, the box and the plus share one line, and nothing leaves the toolbar.
      await page.addStyleTag({ content: 'html{font-size:200% !important}' });
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
          message: 'R4 C2: the root font size did not become 32px after the 200% style tag',
        })
        .toBe('32px');
      await expect.poll(async () => (await rect(count, 'the player-count box')).width, { message: 'O-M4: the 4rem player-count box did not grow to 128px at 200% text' }).toBeGreaterThan(127);
      const big = await readRow();
      expectSquare(big.dec, 44, 'the decrease stepper at 320 / 200%');
      expectSquare(big.inc, 44, 'the increase stepper at 320 / 200%');
      for (const [name, stepper] of [['decrease', decrement], ['increase', increment]] as const) {
        const glyph = await stepper.evaluate((el) => Number.parseFloat(getComputedStyle((el.firstElementChild as Element | null) ?? el).fontSize));
        expect(glyph, `O-M4: the ${name} stepper's glyph is ${glyph}px at 320 / 200%, over the 32px cap`).toBeLessThanOrEqual(32);
      }
      const centre = (r: { top: number; height: number }) => r.top + r.height / 2;
      expect(Math.abs(centre(big.dec) - centre(big.box)), `O-M4: at 320 / 200% the box is not on the decrease stepper's line (${JSON.stringify(big)})`).toBeLessThanOrEqual(1);
      expect(Math.abs(centre(big.inc) - centre(big.box)), `O-M4: at 320 / 200% the box is not on the increase stepper's line (${JSON.stringify(big)})`).toBeLessThanOrEqual(1);
      expectInsideBar(big, '320 / 200%');
      const strays = await controls.evaluate((bar) => {
        const edge = bar.getBoundingClientRect().right;
        return Array.from(bar.querySelectorAll('button, select'))
          .map((el) => ({ name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(), right: el.getBoundingClientRect().right }))
          .filter((el) => el.right > edge + 0.5)
          .map((el) => `${el.name} ends at ${el.right.toFixed(1)}, toolbar edge ${edge.toFixed(1)}`);
      });
      expect(strays, 'R5-01a: a toolbar control ends past the toolbar at 320 / 200%').toEqual([]);
    } finally {
      route.release();
    }
  };

  test('R4 C2 (88.9-52): the player-count steppers are 44 by 44 squares and the row fits at 320px', async ({ page }) => {
    await stepperRowProof(page, false);
  });

  test('R4 C2 (88.9-52), O-M4 Fixed+ (89.6-18): at 320px with text at 200% the steppers hold 44 by 44, the minus, box and plus share a line, and nothing in the toolbar leaves the dialog', async ({ page }) => {
    // DECISION Phase 88.9-52 (owner 2026-11-18): this 320 wide / 200% text read is marked as an
    // expected failure, kept running, over skipping it, deleting it or patching the screen. The
    // fix / see / fix rule stopped screen-by-screen patching at this size; Phase 89.6 researches
    // the large-text method and owns this read. When the screen is fixed this test reports an
    // unexpected pass: remove the test.fail line then. Removing it earlier is a decision, not a cleanup.
    test.fail(true, 'Known failure at 320 wide with 200% text, owned by Phase 89.6 (planning:.planning/deferred/phase-89.6.md, heading Found by the final picture pass (R5) and by CI at FE 06c2db4)');
    await stepperRowProof(page, true);
  });

  test('D15b (88.9): the results dim to 85% while a refresh is in flight, the meta line still reads, and they return to full after', async ({ page }) => {
    // The RULINGS Q7 default (85%); plan 88.9-44 builds it as the only value. 70% is not built:
    // the muted meta line reads 3.29 / 3.72 through it.
    const DIM = 0.85;
    const FLOOR = 4.5;
    const route = await installSuggestionsRoute(page);

    // DECISION Phase 88.9-44 D15b (both themes): the title-through-dim read rides plan 21's dim
    // test, chosen OVER a new contrast.spec.ts test (the round-2 FLOOR chain stays 41 and the dim
    // has one test that owns it). The read multiplies ancestor opacity
    // (e2e/support/contrast.ts ("export async function inkRatioThroughOpacity(")); ratioAgainstGround
    // would ignore it. The held-refresh body runs once per theme, dark first by an init script and
    // light by emulateMedia plus forceLightMode, the plan-20 order copied as spec-local code; every
    // read (title, meta line, rating number, star) runs in both arms, after assertTheme.
    const heldRefreshArm = async (theme: 'light' | 'dark') => {
      try {
        const browse = await openBrowseGames(page);
        await assertTheme(page, theme);
        const results = browse.getByTestId('browse-more-results');
        const childOpacities = () =>
          results.evaluate((el) => Array.from(el.children).map((child) => Number.parseFloat(getComputedStyle(child).opacity)));

        route.hold();
        await browse.getByRole('button', { name: 'Increase player count' }).click();
        await expect(results).toHaveAttribute('aria-busy', 'true');

        const busy = await childOpacities();
        expect(busy.length, `D15b (${theme}): the results region has no child to dim — the read below would be vacuous`).toBeGreaterThan(0);
        for (const [i, value] of busy.entries()) {
          expect(value, `D15b (${theme}): results child ${i + 1} computes opacity ${value} while busy, not ${DIM}`).toBe(DIM);
        }

        // Plan 88.9-44: the card TITLE through the dim (anti-vacuity: the opacity product must be
        // the dim itself, so a read on an undimmed tree cannot pass the floor by accident).
        const title = results.getByText(GAME_ALPHA.name, { exact: true });
        const titleRead = await inkRatioThroughOpacity(title, `D15b title (${theme})`);
        expect(titleRead.opacity, `D15b title (${theme}): reads through opacity ${titleRead.opacity}, not ${DIM} — the dim is not in the product`).toBeCloseTo(DIM, 2);
        expect(
          titleRead.ratio,
          `D15b title (${theme}): ${titleRead.ratio.toFixed(3)}:1 through opacity ${titleRead.opacity}, floor ${FLOOR}:1`,
        ).toBeGreaterThanOrEqual(FLOOR);

        // ONE ink read through the dim: the first card's 14px muted meta line, the
        // src/app/components/GameSuggestionCard.js ("flex flex-wrap gap-x-3 gap-y-1 text-sm text-content-muted") span, reached through
        // the card's aria-describedby (the meta id is first, the rating id last when it renders,
        // src/app/components/GameSuggestionCard.js ("const describedBy = [metaId, hasOwners ? ownersId : null, hasRating ? ratingId : null]")).
        const card = browse.getByRole('button', { name: GAME_ALPHA.name });
        const ids = ((await card.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
        expect(ids.length, `D15b (${theme}): the first card carries no aria-describedby ids (meta + rating expected)`).toBeGreaterThanOrEqual(2);
        const meta = browse.locator(`[id="${ids[0]}"]`);
        const ratingLine = browse.locator(`[id="${ids[ids.length - 1]}"]`);
        const star = ratingLine.locator('xpath=./span[1]');

        const metaRead = await inkRatioThroughOpacity(meta, `D15b meta line (${theme})`);
        expect(metaRead.opacity, `D15b (${theme}): the meta line reads through opacity ${metaRead.opacity} — the dim is not in the product`).toBeLessThan(1);
        expect(
          metaRead.ratio,
          `D15b meta line (${theme}): ${metaRead.ratio.toFixed(3)}:1 through opacity ${metaRead.opacity} (ink ${metaRead.effectiveFg} on ${metaRead.ground}), floor ${FLOOR}:1`,
        ).toBeGreaterThanOrEqual(FLOOR);

        // DEC-2 (ink-agnostic): the rating number and its star through the same dim. The test
        // names no ink; it reds on the shipped yellow and greens on the owner's pick (plan 88.9-44).
        await expect(ratingLine, `D15b (${theme}): the rating line did not render — GAME_ALPHA carries a rating`).toBeVisible();
        for (const [what, el] of [['rating number', ratingLine], ['rating star', star]] as const) {
          const r = await inkRatioThroughOpacity(el, `D15b ${what} (${theme})`);
          expect(r.opacity, `D15b ${what} (${theme}): opacity ${r.opacity} — the dim is not in the product`).toBeLessThan(1);
          expect(
            r.ratio,
            `D15b ${what} (${theme}): ${r.ratio.toFixed(3)}:1 through opacity ${r.opacity} (ink ${r.effectiveFg} on ${r.ground}), floor ${FLOOR}:1`,
          ).toBeGreaterThanOrEqual(FLOOR);
        }

        route.release();
        await expect(results).not.toHaveAttribute('aria-busy', 'true');
        const after = await childOpacities();
        for (const [i, value] of after.entries()) {
          expect(value, `D15b (${theme}): results child ${i + 1} computes opacity ${value} after the refresh, not 1`).toBe(1);
        }
      } finally {
        route.release();
      }
    };

    await test.step('D15b — dark', async () => {
      const darkWriter = await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
      try {
        await heldRefreshArm('dark');
      } finally {
        await darkWriter.dispose();
      }
    });
    await test.step('D15b — light', async () => {
      await page.emulateMedia({ colorScheme: 'light' });
      await forceLightMode(page);
      await heldRefreshArm('light');
    });
  });
});
