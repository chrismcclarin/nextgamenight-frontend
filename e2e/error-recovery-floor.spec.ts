import { test, expect, type Locator, type Page } from '@playwright/test';

// Phase 88.6.1 plan 21: the shared error surfaces' recovery controls, proven on a phone (375 x 667).
//
// WHAT THIS PROVES, at 375px in a real browser:
//   - AC-10 (as amended by SPEC amendment row 48): four recovery controls measure at least 44 x 44
//     — FetchErrorBanner's full `Try again` and `Report this`, its compact `Retry`, and
//     ErrorFallback's `Reload page`.
//   - Req 7 shape: each paints the house focus ring on KEYBOARD focus and not on a pointer press.
//   - Req 5: when a retry removes the focused control, focus lands on the host's `focusTarget` when
//     it passes one, else the page floor (`main h1`, else `main`), never on <body>. /userProfile's
//     schedules banner passes the panel's level-3 heading (DECISION Phase 88.6.1-59 (AC-29 / RF1,
//     D-05) at its mount; DECISION Phase 88.6.1-70 (Req 5, focusTarget) in FetchErrorBanner), so
//     test 1 expects that heading; test 2's notice passes none, so it expects the floor.
//   - D-47 / copy row B1: a failed compact retry is told — the visible line AND the same polite
//     region read "Some personal controls are still unavailable.", and a second failure re-speaks.
//   - AC-9's in-flight half, where the banner stays mounted: the pressed retry keeps focus, carries
//     aria-disabled="true" (never the native attribute), reads `Retrying…`, and a second press is
//     refused.
//
// WHAT IT DOES NOT MEASURE, and why:
//   - ErrorFallback's `Try again` is source-pinned only (controlSizeFloor.test.tsx). No production
//     route can render it on demand: a render-throw hook would be a denial-of-service switch in
//     production (e2e/route-fallbacks.spec.ts:44-45). Its sibling `Reload page` is measured
//     (test 3). That is AC-10 as amended by SPEC amendment row 48: four measured, one source-pinned.
//   - The in-flight state on /userProfile: that page's caller swaps the schedules banner for its
//     loading line at the press (a never-loaded TanStack query reports `pending`), so test 1 proves
//     the floor at the press instead, and test 5 proves the in-flight state on the planning page's
//     role read, where the banner stays mounted.
//
// NOT RUN LOCALLY. The `phone` project depends on the `setup` project (Auth0 login with CI-only
// credentials) and `.auth/user.json` does not exist locally (C-14 in
// .planning/codebase/FE-TESTING-CONVENTIONS.md). Typecheck and collection are the local proof;
// the CI e2e job is the proof.
//
// SYNTHETIC FAILURES, NO WRITES. Only browser GETs are intercepted (the schedules list, the
// identity read, the members read, /api/auth/me). A success is either fulfilled in the browser or
// handed back with route.fallback(), the same read every page load makes. No write is
// intercepted, forced or passed through. No production hook was added for this spec.

// Seeded fixture minted by the backend's scripts/e2e-fixtures.js in CI (plan 16's spec shape).
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// Copy rows: the first-failure notice is shipped copy (FetchErrorBanner's COMPACT_NOTICE); B1 is
// COMPACT_NOTICE_AFTER_FAILED_RETRY, ratified by the owner on 2026-10-05 (D-47).
const FIRST_FAILURE_NOTICE = 'Some personal controls are unavailable.';
const B1_NOTICE = 'Some personal controls are still unavailable.';

// The identity GET: `/users/<encodeURIComponent(auth0 sub)>` (src/lib/api.ts, `getUser`); an Auth0
// sub carries a pipe, which encodes as %7C.
const IDENTITY_GET = /\/users\/[^/?]*%7C[^/?]*(\?|$)/i;
// The schedules list on /userProfile (src/lib/api.ts, `/availability/user/<id>/patterns`).
const PATTERNS_GET = /\/availability\/user\/[^/]+\/patterns/;

/** The control's box is at least 44 x 44 CSS px. */
async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label}: boundingBox() returned null — not rendered`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label}: width ${box.width}px is under the 44px floor`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label}: height ${box.height}px is under the 44px floor`).toBeGreaterThanOrEqual(44);
}

/** The ring paints on keyboard focus (focus-visible) and NOT on a pointer press. */
async function expectKeyboardRingOnly(page: Page, locator: Locator, label: string) {
  // Keyboard: arrive by Tab so the browser's focus-visible heuristic sees keyboard modality.
  await locator.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(locator, `${label}: Tab lands back on the control`).toBeFocused();
  expect(await locator.evaluate((el) => el.matches(':focus-visible')), `${label}: keyboard focus is focus-visible`).toBe(true);
  await expect(locator, `${label}: the ring paints on keyboard focus`).not.toHaveCSS('box-shadow', 'none');

  // Pointer: leave the control, then press on it and release elsewhere, so it is never activated.
  await locator.evaluate((el) => (el as HTMLElement).blur());
  const box = await locator.boundingBox();
  expect(box, `${label}: boundingBox() returned null — not rendered`).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const focusedByPointer = await locator.evaluate((el) => el === document.activeElement);
  if (focusedByPointer) {
    expect(await locator.evaluate((el) => el.matches(':focus-visible')), `${label}: a pointer press is not focus-visible`).toBe(false);
    await expect(locator, `${label}: no ring on a pointer press`).toHaveCSS('box-shadow', 'none');
  } else {
    // Recorded, never silent: in this project a pointer press did not focus the control, so the
    // pointer half cannot be observed. The keyboard half above still ran.
    test.info().annotations.push({
      type: 'pointer-focus',
      description: `${label}: mousedown did not focus the control in this project; pointer half not observable`,
    });
    await expect(locator, `${label}: no ring without focus`).toHaveCSS('box-shadow', 'none');
  }
  await page.mouse.move(1, 1);
  await page.mouse.up();
}

test.describe('error recovery controls on a phone (88.6.1-21: AC-10, Req 5, Req 7 ring, D-47 / B1, AC-9)', () => {
  // Runs ONLY in the `phone` project: both `journeys` and `phone` collect every spec, and these
  // floors are phone-scoped (`min-h-11 md:min-h-0`), so `journeys` would measure the desktop
  // opt-out. A runtime skip, not a collection filter.
  test.skip(({ isMobile }) => !isMobile, 'AC-10 at 375px: the recovery-control floors are phone-scoped');

  test('1: the full banner on /userProfile — floor, ring, and focus on the panel heading at the press', async ({ page }) => {
    let mode: 'fail' | 'hold' = 'fail';
    let retryHits = 0;
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(PATTERNS_GET, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (mode === 'fail') {
        await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
        return;
      }
      retryHits += 1;
      await released;
      await route.fulfill({ status: 200, json: [] });
    });

    await page.goto('/userProfile');

    const retry = page.getByRole('button', { name: /^(Try again|Retrying…)$/ });
    // A missing banner is a failure, never a skip.
    await expect(retry).toHaveCount(1, { timeout: 15_000 });
    const report = page.getByRole('button', { name: 'Report this' });
    await expectTouchTarget(retry, 'full Try again');
    await expectKeyboardRingOnly(page, retry, 'full Try again');

    // Owner ruling 2026-10-05 (plan 88.6.1-69): Report this appears only after a retry has failed.
    // At the first failure there is none; a failed Try again (mode still 'fail') brings it. The
    // caller removes this banner at the press and re-inserts it on failure, so the link appearing is
    // the real-browser proof that the host's memory survived the unmount. Only then is it measured.
    await expect(report).toHaveCount(0);
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1, { timeout: 15_000 });
    await expect(report).toHaveCount(1, { timeout: 15_000 });
    await expectTouchTarget(report, 'Report this');
    await expectKeyboardRingOnly(page, report, 'Report this');

    mode = 'hold';
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => retryHits).toBe(1);

    // The caller swapped the banner for its loading line at the press; focus is on the banner's
    // focusTarget, the Schedules panel's own heading (plan 59's D-05 wiring, which supersedes this
    // test's original `main h1` floor expectation: wave 7 CI gate, run 39020174955), never <body>.
    await expect(retry).toHaveCount(0);
    const heading = page.getByRole('main').getByRole('heading', { level: 3, name: 'Availability Schedules' });
    await expect(heading).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body), 'never <body>').toBe(false);

    // A second Enter lands on the heading and retries nothing.
    await page.keyboard.press('Enter');
    release();
    await expect(page.getByText('Loading schedules...')).toHaveCount(0, { timeout: 15_000 });
    expect(retryHits).toBe(1);
    await expect(heading).toBeFocused();
  });

  test('2: the compact notice on / — floor, ring, and focus on main when the retry succeeds', async ({ page }) => {
    let mode: 'fail' | 'pass' = 'fail';
    await page.route(IDENTITY_GET, async (route) => {
      if (route.request().method() !== 'GET' || mode === 'pass') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
    });

    await page.goto('/');

    // At 375px the visible compact notice is GroupList's (the desktop column copy is hidden).
    const retry = page.getByRole('button', { name: /^(Retry|Retrying…)$/ });
    await expect(retry).toHaveCount(1, { timeout: 15_000 });
    await expectTouchTarget(retry, 'compact Retry');
    await expectKeyboardRingOnly(page, retry, 'compact Retry');

    mode = 'pass';
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(retry).toHaveCount(0, { timeout: 15_000 });
    // The signed-in home has no <h1>, so the floor is `main` (plan 88.6.1-04, OQ-5).
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('3: the error screen on /userProfile — Reload page floor and ring (Try again is source-pinned)', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 500, body: '' }));

    await page.goto('/userProfile');

    const reload = page.getByRole('button', { name: 'Reload page' });
    await expect(reload).toBeVisible({ timeout: 15_000 });
    await expectTouchTarget(reload, 'Reload page');
    await expectKeyboardRingOnly(page, reload, 'Reload page');
    // This mount passes no retry handler: ErrorFallback's Try again is the source-pinned control.
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('4: B1 on the planning page — a failed compact retry is told, twice, through the same region', async ({ page }) => {
    let gate: Promise<void> | null = null;
    let open: () => void = () => {};
    const closeGate = () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    };
    await page.route(IDENTITY_GET, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (gate) await gate;
      await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
    });

    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    const line = page.locator('span', { hasText: FIRST_FAILURE_NOTICE });
    await expect(line).toBeVisible({ timeout: 15_000 });
    const region = await page.getByRole('status').filter({ hasText: FIRST_FAILURE_NOTICE }).elementHandle();
    expect(region, 'the compact polite region was not found').not.toBeNull();
    if (!region) return;
    const heading = page.getByRole('main').getByRole('heading', { level: 1 });

    for (const round of [1, 2]) {
      closeGate();
      await page.getByRole('button', { name: 'Retry', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => region.evaluate((n) => n.textContent), { message: `failure ${round}: emptied` }).toBe('');
      // Never-loaded identity: the visible row leaves at the press, so focus takes the page floor.
      await expect(heading).toBeFocused();

      open();
      await expect
        .poll(() => region.evaluate((n) => n.textContent), { timeout: 15_000, message: `failure ${round}: B1` })
        .toBe(B1_NOTICE);
      expect(await region.evaluate((n) => n.isConnected), 'the SAME region node').toBe(true);

      const visibleB1 = page.locator('span', { hasText: B1_NOTICE });
      await expect(visibleB1).toBeVisible();
      await expect(visibleB1).toHaveText(B1_NOTICE);
      const box = await visibleB1.boundingBox();
      const viewport = page.viewportSize();
      expect(box).not.toBeNull();
      expect(viewport).not.toBeNull();
      if (box && viewport) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    }
  });

  test('5: the in-flight state where the banner stays mounted — the planning role read (plan 16)', async ({ page }) => {
    let mode: 'fail' | 'hold' = 'fail';
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The members read is `groupsAPI.getGroupMembers` -> GET `/groups/<id>/users` (plan 16's predicate).
    await page.route(
      (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        if (mode === 'hold') await released;
        await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
      },
    );

    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    const line = page.locator('span', { hasText: FIRST_FAILURE_NOTICE });
    await expect(line).toBeVisible({ timeout: 15_000 });
    const region = await page.getByRole('status').filter({ hasText: FIRST_FAILURE_NOTICE }).elementHandle();
    expect(region, 'the compact polite region was not found').not.toBeNull();
    if (!region) return;

    mode = 'hold';
    const retry = page.getByRole('button', { name: /^(Retry|Retrying…)$/ });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await expect(retry).not.toHaveAttribute('disabled');
    await expect(retry).toBeFocused();
    await expect(retry).toHaveText('Retrying…');
    expect(await region.evaluate((n) => n.textContent), 'the region is quiet in flight').toBe('');

    // A second press while the read is held is refused: still in flight, still focused.
    await page.keyboard.press('Enter');
    await expect(retry).toHaveText('Retrying…');
    await expect(retry).toBeFocused();

    release();
    await expect(retry).toHaveText('Retry', { timeout: 15_000 });
    await expect(retry).toBeFocused();
    await expect(retry).not.toHaveAttribute('aria-disabled');
    // Plan 16's role read resolves LOAD_FAILED on this held-then-500 read, so the outcome is known:
    // B1, exactly. The first-failure sentence here would be a failure.
    await expect
      .poll(() => region.evaluate((n) => n.textContent), { timeout: 15_000 })
      .toBe(B1_NOTICE);
    await expect(page.locator('span', { hasText: B1_NOTICE })).toHaveText(B1_NOTICE);
  });
});
