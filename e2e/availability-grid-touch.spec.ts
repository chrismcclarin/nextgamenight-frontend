import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';

/**
 * Phase 87.8 plan 14 — MOB-04: touch gesture model on the check-in availability
 * grid (AvailabilityGrid.js), PHONE PROJECT ONLY.
 *
 * Pins the five touch behaviors of the long-press paint model (owner ruling
 * 2026-08-02, model (a) — see the DECISION Phase 87.8 (TOUCH) marker in
 * AvailabilityGrid.js):
 *   1. plain vertical drag scrolls the page, selects nothing
 *   2. plain horizontal drag scrolls the grid container — Sunday becomes
 *      reachable (the literal owner symptom at 375px)
 *   3. a tap toggles exactly one slot, committed on finger-up
 *   4. long-press (~300ms) then drag paints the crossed range; the non-passive
 *      touchmove preventDefault suppresses scroll DURING the paint
 *   5. holding the finger in the bottom edge band while painting auto-scrolls
 *      and KEEPS PAINTING slots that started below the viewport (the owner's
 *      10-to-7 case), and stops cleanly on release
 *
 * RAW CDP, NOT page.touchscreen — DO NOT "SIMPLIFY": Playwright's
 * `page.touchscreen` only taps; the drag paths need real touch streams
 * (`Input.dispatchTouchEvent`: touchStart, ~400ms hold, stepped touchMoves,
 * touchEnd). CDP requires chromium — the phone project's explicit chromium
 * override (playwright.config.ts D-14) is what makes this possible.
 *
 * PROJECT GUARD: `journeys` and `phone` share `testMatch: /.*\.spec\.ts/`, so
 * this file skips the desktop project the same way touch-targets.spec.ts:117
 * does. Touch behavior is a phone-tenet concern measured at 375x667.
 *
 * SELECTOR NOTE: painted-state assertions use `[data-slot-id]` +
 * `aria-pressed` — data-slot-id is WriteCell's own paint-resolution attribute
 * (the same test-plumbing class as WeekGrid's data-coord), and aria-pressed is
 * the cell's accessible pressed state. Interactive controls are still located
 * by role/label/text only.
 *
 * STATE NOTE: availability-submit.spec.ts (journeys project, runs before
 * phone) submits slots for this same seeded token, so the form may load in
 * update mode with pre-painted slots. Every test normalizes to an empty
 * selection via the Clear All button first — client-side only, no server
 * writes (nothing here ever submits).
 *
 * Fixtures follow the env-const idiom: E2E_AVAILABILITY_TOKEN is the seeded
 * availability magic-link token minted in CI. Do not run locally — e2e is
 * CI-only by design (playwright.config.ts:19-21).
 */

const E2E_AVAILABILITY_TOKEN = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';

/** Grid geometry constants mirroring AvailabilityGrid.js — used only to place
 *  touch points safely, never asserted on directly. */
const ROW_HEIGHT = 48; // h-12 at phone width (sm: is 640px, so 375px gets h-12)
const EDGE_BAND_PX = 48; // the component's auto-scroll band
const VIEWPORT_H = 667; // iPhone SE (3rd gen) preset — D-06

/** All painted cells (any preference tier). */
const paintedCells = (page: Page) => page.locator('[data-slot-id][aria-pressed="true"]');

/** Day header locator — AvailabilityGrid formats headers as 'EEE M/d'. */
const dayHeaders = (page: Page) =>
  page.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}\/\d{1,2}$/);

/** Vacuity guard (touch-targets.spec.ts pattern): a zero-count locator makes
 *  every assertion after it vacuous — fail loudly at the locator instead. */
async function guardResolved(locator: Locator, what: string, atLeast = 1): Promise<void> {
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected >= ${atLeast}) — a zero-count locator makes the assertions after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the touch-model work`,
  ).toBeGreaterThanOrEqual(atLeast);
}

/** Load the form and normalize to an empty selection (see STATE NOTE). */
async function gotoCleanGrid(page: Page): Promise<void> {
  await page.goto(`/availability-form/${E2E_AVAILABILITY_TOKEN}`);
  // Grid rendered: the Select All checkbox is the grid's stable landmark.
  await expect(page.getByRole('checkbox', { name: /^all$/i }).first()).toBeVisible();
  const clearAll = page.getByRole('button', { name: 'Clear All' });
  if ((await clearAll.count()) > 0) {
    await clearAll.click();
  }
  await expect(paintedCells(page)).toHaveCount(0);
}

/** Scroll the page so the 10:00 AM row sits near the viewport top (outside the
 *  top edge band), leaving the drag corridor below it band-free. Returns the
 *  day-0 column center x and the y of the 10:00 AM row center. */
async function positionTenAmNearTop(page: Page): Promise<{ xDay0: number; yTenAm: number }> {
  // 87.8-13 F-7: at phone width the label column renders the COMPACT '10:00a'
  // span (sm:hidden); the full '10:00 AM' span exists but is hidden sm:inline,
  // so its boundingBox is null in this phone-project spec. Target the visible one.
  const tenAm = page.getByText('10:00a', { exact: true });
  await guardResolved(tenAm, 'the 10:00a time label');
  await tenAm.scrollIntoViewIfNeeded();
  const before = await tenAm.boundingBox();
  expect(before, '10:00a label has no boundingBox').not.toBeNull();
  // Nudge so the row center lands ~120px from the top (inside the viewport,
  // clear of the 48px top band).
  await page.evaluate((dy) => window.scrollBy(0, dy), before!.y + before!.height / 2 - 120);
  const label = await tenAm.boundingBox();
  const header = await dayHeaders(page).first().boundingBox();
  expect(header, 'first day header has no boundingBox').not.toBeNull();
  return {
    xDay0: header!.x + header!.width / 2,
    yTenAm: label!.y + label!.height / 2,
  };
}

// --- Raw CDP touch primitives ------------------------------------------------

async function touchStart(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
}

async function touchMove(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y, id: 1 }],
  });
}

async function touchEnd(cdp: CDPSession): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Stepped move from (x1,y1) to (x2,y2) — a real drag stream, each step small
 *  enough that no grid row can be skipped by the paint resolution. */
async function steppedMoves(
  cdp: CDPSession,
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    await touchMove(
      cdp,
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await page.waitForTimeout(30);
  }
}

/** A plain swipe: start, immediate stepped moves (movement > the 8px slop well
 *  before the 300ms long-press timer), end. The browser owns this gesture. */
async function swipe(
  cdp: CDPSession,
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await touchStart(cdp, from.x, from.y);
  await steppedMoves(cdp, page, from, to, 8);
  await touchEnd(cdp);
}

/** Long-press (hold past the 300ms timer) — enters paint mode. */
async function longPress(cdp: CDPSession, page: Page, at: { x: number; y: number }): Promise<void> {
  await touchStart(cdp, at.x, at.y);
  await page.waitForTimeout(400); // > LONG_PRESS_MS (300) with margin
}

test.describe('Phase 87.8 MOB-04 — check-in grid touch model (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch gesture model is a phone-tenet requirement — phone project only');

  test('(1) vertical plain drag scrolls the page and selects nothing', async ({ page }) => {
    await gotoCleanGrid(page);
    const { xDay0, yTenAm } = await positionTenAmNearTop(page);
    const cdp = await page.context().newCDPSession(page);

    const scrollYBefore = await page.evaluate(() => window.scrollY);

    // Swipe UP starting ON a cell (finger moves up -> page scrolls down).
    await swipe(cdp, page, { x: xDay0, y: yTenAm + 200 }, { x: xDay0, y: yTenAm + 40 });

    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message:
          'a plain vertical drag starting on a grid cell did not scroll the page — a static gesture blocker is back on the grid (the pre-87.8-14 defect)',
      })
      .toBeGreaterThan(scrollYBefore);
    await expect(paintedCells(page)).toHaveCount(0);
  });

  test('(2) horizontal plain drag scrolls the grid — Sunday becomes reachable', async ({ page }) => {
    await gotoCleanGrid(page);
    const { xDay0, yTenAm } = await positionTenAmNearTop(page);
    const cdp = await page.context().newCDPSession(page);

    const headers = dayHeaders(page);
    await guardResolved(headers, 'the day header row', 7);
    expect(await headers.count(), 'the check-in grid renders a 7-day window').toBe(7);
    const lastHeader = headers.nth(6);
    await expect(
      lastHeader,
      'the last day header must start with Sun — the check-in window is Monday-anchored; if this fails the FIXTURE window changed, and the Sunday-reachability assertion below needs re-anchoring, not deleting',
    ).toHaveText(/^Sun /);

    // Precondition (vacuity guard for the symptom): Sunday starts OFF-screen.
    await expect(
      lastHeader,
      'Sunday is already in the viewport before any swipe — the grid no longer overflows at 375px and this regression fence needs re-examining, not deleting',
    ).not.toBeInViewport();

    // The horizontal scroll container: nearest ancestor of the header row that
    // actually overflows horizontally (structural, not class-based).
    const scrollLeftOf = () =>
      lastHeader.evaluate((el) => {
        let node: HTMLElement | null = el.parentElement;
        while (node) {
          if (node.scrollWidth > node.clientWidth + 10) return node.scrollLeft;
          node = node.parentElement;
        }
        return -1;
      });
    const scrollLeftBefore = await scrollLeftOf();
    expect(scrollLeftBefore, 'no horizontally overflowing ancestor found for the grid').toBeGreaterThanOrEqual(0);

    // Two leftward swipes on the grid body (day widths total ~672px vs 375px viewport).
    await swipe(cdp, page, { x: 340, y: yTenAm }, { x: 40, y: yTenAm });
    await swipe(cdp, page, { x: 340, y: yTenAm }, { x: 40, y: yTenAm });

    await expect
      .poll(scrollLeftOf, {
        message:
          'a horizontal drag on the grid did not increase the scroll container scrollLeft — horizontal panning is dead on touch again',
      })
      .toBeGreaterThan(scrollLeftBefore);
    await expect(
      lastHeader,
      'Sunday never entered the viewport after two full-width leftward swipes — the "cannot reach Sunday" owner symptom has regressed',
    ).toBeInViewport();
    await expect(paintedCells(page)).toHaveCount(0);
  });

  test('(3) a tap toggles exactly one slot, committed on finger-up', async ({ page }) => {
    await gotoCleanGrid(page);
    const { xDay0, yTenAm } = await positionTenAmNearTop(page);
    const cdp = await page.context().newCDPSession(page);

    // Identify the exact cell under the tap point BEFORE tapping.
    const tappedSlotId = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-slot-id]')?.getAttribute('data-slot-id') ?? null,
      { x: xDay0, y: yTenAm },
    );
    expect(tappedSlotId, `no grid cell resolved at the tap point (${xDay0}, ${yTenAm})`).not.toBeNull();

    // CDP tap: start + end, no movement, well under the 300ms long-press timer.
    await touchStart(cdp, xDay0, yTenAm);
    await page.waitForTimeout(60);
    await touchEnd(cdp);

    await expect(paintedCells(page)).toHaveCount(1);
    await expect(page.locator(`[data-slot-id="${tappedSlotId}"]`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('(4) long-press then drag paints the crossed range without scrolling', async ({ page }) => {
    await gotoCleanGrid(page);
    const { xDay0, yTenAm } = await positionTenAmNearTop(page);
    const cdp = await page.context().newCDPSession(page);

    // 10:00 -> 2:00 PM is 8 rows down: 9 slots inclusive (the owner's example gesture).
    const yTwoPm = yTenAm + 8 * ROW_HEIGHT;

    // Precondition: the whole drag corridor is OUTSIDE the edge bands, so the
    // auto-scroll loop can never engage — this test isolates the preventDefault.
    expect(yTenAm, 'drag start sits inside the top edge band — reposition the corridor').toBeGreaterThan(EDGE_BAND_PX + 10);
    expect(yTwoPm, 'drag end sits inside the bottom edge band — reposition the corridor').toBeLessThan(VIEWPORT_H - EDGE_BAND_PX - 10);

    const scrollYBefore = await page.evaluate(() => window.scrollY);

    await longPress(cdp, page, { x: xDay0, y: yTenAm }); // paint mode + first slot
    await steppedMoves(cdp, page, { x: xDay0, y: yTenAm }, { x: xDay0, y: yTwoPm });
    await touchEnd(cdp);

    // Every 30-minute slot 10:00 through 14:00, in day 0 only.
    await expect(paintedCells(page)).toHaveCount(9);
    const centers = await paintedCells(page).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { cx: r.left + r.width / 2, w: r.width };
      }),
    );
    for (const { cx, w } of centers) {
      expect(
        Math.abs(cx - xDay0),
        `a painted cell's center (${cx}) is outside the day-0 column (${xDay0} +/- ${w / 2}) — a gesture wrote outside its own day (composes with plan 03's no-cross-day fence)`,
      ).toBeLessThan(w / 2);
    }

    // The non-passive preventDefault is load-bearing and this is its test: a
    // mid-viewport paint drag must NOT scroll the page.
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(
      scrollYAfter,
      'the page scrolled during a mid-viewport paint drag — the paint-gated non-passive touchmove preventDefault is not suppressing native scroll',
    ).toBe(scrollYBefore);
  });

  test('(5) edge auto-scroll paints off-screen slots and stops on release (the 10-to-7 case)', async ({ page }) => {
    await gotoCleanGrid(page);
    const { xDay0, yTenAm } = await positionTenAmNearTop(page);
    const cdp = await page.context().newCDPSession(page);

    // Vacuity guard + target: a day-0 cell that starts BELOW the viewport.
    const target = await page.evaluate(
      ({ x }) => {
        const below = Array.from(document.querySelectorAll('[data-slot-id]'))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter((c) => Math.abs(c.r.left + c.r.width / 2 - x) < c.r.width / 2)
          .filter((c) => c.r.top > window.innerHeight)
          .sort((a, b) => a.r.top - b.r.top);
        // A couple of rows past the fold: unambiguously unreachable without scroll.
        const pick = below[Math.min(2, below.length - 1)];
        return pick ? { slotId: pick.el.getAttribute('data-slot-id'), top: pick.r.top } : null;
      },
      { x: xDay0 },
    );
    expect(
      target,
      'no day-0 cell starts below the viewport — the grid fits on one screen and the auto-scroll case is untestable; fix the positioning step, not the feature',
    ).not.toBeNull();

    const scrollYStart = await page.evaluate(() => window.scrollY);

    // Long-press a morning cell, drag into the bottom edge band, then HOLD.
    const bandY = VIEWPORT_H - 20; // 647 — well inside the 48px bottom band
    await longPress(cdp, page, { x: xDay0, y: yTenAm });
    await steppedMoves(cdp, page, { x: xDay0, y: yTenAm }, { x: xDay0, y: bandY });

    // While holding (finger stationary — NO further touch events): the rAF loop
    // must drive BOTH the scroll and the painting.
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: 'holding in the bottom edge band did not auto-scroll the page',
      })
      .toBeGreaterThan(scrollYStart);
    const scrollYMid = await page.evaluate(() => window.scrollY);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: 'auto-scroll stalled while the finger stayed in the band — the loop must keep scrolling frame over frame',
      })
      .toBeGreaterThan(scrollYMid);
    await expect(
      page.locator(`[data-slot-id="${target!.slotId}"]`),
      'the auto-scroll loop scrolled but never painted the newly revealed cells — the rAF tick must re-run the paint step at the last-known finger coords (a stationary finger fires no pointermove)',
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    // Release: scrolling stops and no further slots are added.
    await touchEnd(cdp);
    await page.waitForTimeout(150); // let any in-flight frame settle
    const settledScrollY = await page.evaluate(() => window.scrollY);
    const settledCount = await paintedCells(page).count();
    await page.waitForTimeout(120); // ~2 frames beyond a safety margin
    expect(
      await page.evaluate(() => window.scrollY),
      'the page kept scrolling after touchEnd — the edge auto-scroll loop was not cancelled on release',
    ).toBe(settledScrollY);
    expect(
      await paintedCells(page).count(),
      'slots kept being added after touchEnd — paint mode was not torn down on release',
    ).toBe(settledCount);
  });
});
