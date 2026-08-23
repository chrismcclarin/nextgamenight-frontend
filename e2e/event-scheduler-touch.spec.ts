import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';

/**
 * Phase 88.1 plan 14 — the VISUAL create-event scheduler, exercised end to end.
 *
 * WHY THIS FILE EXISTS. SPEC Req 3's stated acceptance is "the Playwright
 * create-event journey is green", but that journey deliberately clicks PAST the
 * scheduler: `e2e/create-event.spec.ts:31-36` switches to manual entry and fills
 * the datetime-local input. It would stay green with the scheduler completely
 * broken, or absent. Every test below stays in VISUAL-CALENDAR mode; that single
 * difference is the point of the file.
 *
 * It pins, with real touch streams (SPEC Req 5's owner-ruled long-press model,
 * `heatmap/usePaintGesture.ts`):
 *   1. a plain drag SCROLLS the day column and selects nothing
 *   2. a tap SELECTS one slot and the "Selected Time:" panel reflects it
 *   3. long-press then drag PAINTS a range spanning the crossed slots
 *   4. movement past the slop distance before the threshold CANCELS (case 1, not 3)
 *   5. holding in the bottom edge band auto-scrolls the DAY COLUMN and keeps
 *      painting slots that started below the fold — while the page BEHIND the
 *      Radix dialog does not move (the RESEARCH C10 regression guard: a
 *      `window.scrollBy` inside the dialog would do nothing, or move the page)
 *   6. tapping a strip cell changes which day the column shows (Req 7's phone arm)
 *   7. the Req 1 visual <-> manual <-> visual slot-selection round-trip
 *
 * CASE 7 IS REQUIRED, NOT OPTIONAL — plan 88.1-07's SUMMARY (deviation 1)
 * records the jsdom fallback: react-big-calendar 1.12.1's `Selection` calls
 * `document.elementFromPoint`, which jsdom does not implement, and stubbing it
 * lands in RESEARCH P7's zero-height-rect trap. `createEvent.integration.test.tsx`
 * therefore drives that contract from the MANUAL side only, and routed the
 * GESTURE-originated half here. This file is the only remaining place that
 * coverage can live. Deleting case 7 deletes Req 1's characterization target.
 *
 * RAW CDP, NOT PLAYWRIGHT'S TOUCHSCREEN HELPER — DO NOT "SIMPLIFY": that helper
 * only taps; the drag paths need real touch streams (`Input.dispatchTouchEvent`:
 * touchStart, ~400ms hold, stepped touchMoves, touchEnd). CDP requires chromium —
 * the phone project's explicit chromium override (playwright.config.ts D-14) is
 * what makes this possible. Proven idiom: `e2e/availability-grid-touch.spec.ts`,
 * green since 87.8-14. (The helper's name is deliberately not spelled here so the
 * plan's absence grep measures the code, not its own description — the same
 * correction plan 88.1-07 made to its `rbc-` gate.)
 *
 * PROJECT GUARD: `journeys` and `phone` share `testMatch: /.*\.spec\.ts/`, so the
 * touch describe skips the DESKTOP project the way touch-targets.spec.ts:138
 * does. The mouse describe at the bottom inverts that guard — mouse range-select
 * is the phase's only analog-free mechanism and nothing else drives it end to end.
 *
 * SELECTOR NOTE: every interactive control is located by ROLE / LABEL / TEXT
 * ("Add New Game Event", "Switch to Manual Entry", `role=tab`, `role=columnheader`,
 * the verbatim "Selected Time:" panel). `[data-coord]` appears ONLY in the
 * geometry/painted-state probes — it is WeekGrid's own paint-resolution attribute
 * (`WeekGrid.tsx:474`, the same test-plumbing class as WriteCell's data-slot-id),
 * and `usePaintGesture` resolves targets through it, so a probe that used
 * anything else would not be measuring the mechanism under test.
 *
 * GEOMETRY CONSTANTS BELOW ARE FOR PLACING TOUCH POINTS ONLY — never asserted on
 * directly (pitfall P5: no pin may assert the threshold NUMBERS; behaviour is
 * asserted relative to them, before/after).
 *
 * FIXTURES: `E2E_GROUP_ID` only — the same seeded id create-event.spec.ts:17 and
 * touch-targets.spec.ts:52 read. No new secret is minted and no credential is
 * written here. e2e is CI-only by design (playwright.config.ts:19-21): author
 * locally, verify in the `phone` lane.
 */

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

/** Hold comfortably past `usePaintGesture`'s LONG_PRESS_MS. Placement, not an assertion. */
const LONG_PRESS_HOLD_MS = 400;
/** `usePaintGesture`'s SLOP_PX — used to size a movement that must EXCEED it. */
const SLOP_PX = 8;
/** `usePaintGesture`'s EDGE_BAND_PX, measured from the scroll container's rect here
 *  (the C10 override: bounds are the container's, not the viewport's). */
const EDGE_BAND_PX = 48;
/** EventScheduler grid geometry: 30-minute slots from 10:00. Row math only. */
const START_HOUR = 10;
const SLOT_MINUTES = 30;

// --- Vacuity guard -----------------------------------------------------------

/** A zero-count locator makes every assertion after it vacuous — fail loudly AT
 *  THE LOCATOR instead. Same contract as touch-targets.spec.ts:63. */
async function guardResolved(locator: Locator, what: string, atLeast = 1): Promise<void> {
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a zero-count locator makes every assertion after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the scheduler work`,
  ).toBeVisible();
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected >= ${atLeast}) — a zero-count locator makes every assertion after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the scheduler work`,
  ).toBeGreaterThanOrEqual(atLeast);
}

/** Narrow a nullable probe result and fail with a diagnosable message if absent. */
function must<T>(value: T | null, what: string): T {
  expect(value, `${what} — the in-page probe returned null, so nothing below it could be measured; fix the probe or the fixture state, never the assertion`).not.toBeNull();
  return value as T;
}

// --- Page objects ------------------------------------------------------------

const dialog = (page: Page) => page.getByRole('dialog');
/** The verbatim panel label EventScheduler renders from the controlled `selectedSlot`. */
const selectedTimeLabel = (page: Page) => dialog(page).getByText('Selected Time:', { exact: true });
/** The value paragraph directly after that label — "Tuesday, August 26, 7:00 PM - 8:00 PM (1 hour)". */
const selectedTimeValue = (page: Page) =>
  selectedTimeLabel(page).locator('xpath=following-sibling::p[1]');

/**
 * Open the create-event modal and STAY in visual-calendar mode.
 *
 * The "Add New Game Event" button lives on the GROUP HOME page, not on
 * /groupPlanning — create-event.spec.ts:19-24 records why.
 */
async function openVisualScheduler(page: Page): Promise<void> {
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

  // Visual mode is the default; the toggle OFFERING manual entry is the proof we
  // are still in it. If this ever fails, the modal opened in manual mode and this
  // whole file would be exercising the bypass it exists to compensate for.
  await expect(
    dialog(page).getByRole('button', { name: /switch to manual entry/i }),
    'the create-event modal did not open in VISUAL-CALENDAR mode — this file exists precisely to cover that mode; do not "fix" it by switching modes',
  ).toBeVisible();

  const grid = dialog(page).getByRole('grid', { name: /group availability by day and time/i });
  await guardResolved(grid, "the scheduler's day/time grid (WeekGrid, read arm)");

  // The heatmap fetch resolves after mount; every case below depends on the
  // fetched week being rendered (the wash, the count badges, `scrollToTime`).
  await expect(
    dialog(page).getByRole('gridcell', { name: /^Availability for \d{4}-\d{2}-\d{2} hour \d+$/ }).first(),
    'no gridcell carries an availability annotation — the CI fixture group has NO availability data, which makes the scheduler cases vacuous. This is a FIXTURE failure (scripts/e2e-fixtures.js owns the invariant), not a scheduler failure',
  ).toBeVisible();
}

// --- In-page geometry probes -------------------------------------------------

interface CellBox {
  coord: string;
  row: number;
  col: number;
  cx: number;
  cy: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface GridGeometry {
  /** WeekGrid's own scroll container — seam 4c, the element `scrollContainerRef` points at. */
  scroller: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    height: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  };
  gridCount: number;
  /** Every cell. Widths/heights are valid even for rows scrolled out of view. */
  cells: CellBox[];
  /** Cells fully inside BOTH the scroller's client box and the viewport — the only
   *  ones `document.elementFromPoint` (and therefore `usePaintGesture`) can resolve. */
  visible: CellBox[];
}

/**
 * Resolve the scroll container STRUCTURALLY, never by class: it is the parent of
 * the `role="grid"` body (`WeekGrid.tsx:419-442`). Everything is scoped to the
 * open dialog because `EventHeatmapBackground` mounts a second WeekGrid on the
 * page BEHIND the modal, and an unscoped `[data-coord]` query would find it.
 */
async function gridGeometry(page: Page): Promise<GridGeometry | null> {
  return page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]');
    if (!root) return null;
    const grids = root.querySelectorAll('[role="grid"]');
    const grid = grids[0] as HTMLElement | undefined;
    const scroller = grid?.parentElement ?? null;
    if (!grid || !scroller) return null;
    const sr = scroller.getBoundingClientRect();
    const cells = Array.from(grid.querySelectorAll('[data-coord]')).map((el) => {
      const coord = el.getAttribute('data-coord') ?? '';
      const [row, col] = coord.split(':').map(Number);
      const r = (el as HTMLElement).getBoundingClientRect();
      return {
        coord,
        row,
        col,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
    const vTop = Math.max(sr.top, 0);
    const vBottom = Math.min(sr.bottom, window.innerHeight);
    return {
      scroller: {
        top: sr.top,
        bottom: sr.bottom,
        left: sr.left,
        right: sr.right,
        height: sr.height,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      },
      gridCount: grids.length,
      cells,
      visible: cells.filter(
        (c) =>
          c.top >= vTop &&
          c.bottom <= vBottom &&
          c.cx > 0 &&
          c.cx < window.innerWidth,
      ),
    };
  });
}

/** Current scrollTop of the day column's own scroller (-1 = not found). */
async function columnScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const grid = document.querySelector('[role="dialog"] [role="grid"]');
    const scroller = grid?.parentElement as HTMLElement | null;
    return scroller ? scroller.scrollTop : -1;
  });
}

/**
 * Park the column at the top before a gesture case.
 *
 * `scrollToTime` (Phase 66-03 CREVT-06) deliberately opens the column ON peak
 * availability, which is asserted in its own case below. The gesture cases need a
 * KNOWN starting window instead, so they normalise here — client-side only, no
 * state is written and nothing is committed.
 */
async function resetColumnScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const grid = document.querySelector('[role="dialog"] [role="grid"]');
    const scroller = grid?.parentElement as HTMLElement | null;
    if (scroller) scroller.scrollTop = 0;
  });
  await expect.poll(() => columnScrollTop(page)).toBe(0);
}

/**
 * Cells safely inside the drag corridor: visible, and clear of BOTH edge bands so
 * the rAF auto-scroll loop can never engage. Case 5 is the one that wants a band.
 */
function corridorCells(geo: GridGeometry, col?: number): CellBox[] {
  const lo = geo.scroller.top + EDGE_BAND_PX + 4;
  const hi = geo.scroller.bottom - EDGE_BAND_PX - 4;
  return geo.visible
    .filter((c) => c.cy > lo && c.cy < hi && (col === undefined || c.col === col))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

// --- The "Selected Time:" panel ---------------------------------------------

interface Selection {
  text: string;
  /** Local minutes-from-midnight of the committed range. */
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  /** Grid row indices (the range is inclusive of `endRow`). */
  startRow: number;
  endRow: number;
  /** Day-of-month from the panel's date, e.g. 26 for "Tuesday, August 26". */
  dayOfMonth: number;
}

function toMinutes(hour: number, minute: number, meridiem: string): number {
  const h = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  return h * 60 + minute;
}

/** Read + parse the panel EventScheduler renders from the controlled `selectedSlot`. */
async function readSelection(page: Page): Promise<Selection> {
  await guardResolved(selectedTimeLabel(page), 'the "Selected Time:" panel (a committed selection must be visible here)');
  const text = ((await selectedTimeValue(page).textContent()) ?? '').replace(/\s+/g, ' ').trim();
  // `format(start, 'EEEE, MMMM d, h:mm a')` + ' - ' + `format(end, 'h:mm a')`.
  const m = text.match(
    /^[A-Za-z]+, [A-Za-z]+ (\d{1,2}), (\d{1,2}):(\d{2})\s?(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s?(AM|PM)/,
  );
  expect(
    m,
    `the "Selected Time:" panel read "${text}", which does not match EventScheduler's "EEEE, MMMM d, h:mm a - h:mm a" shape — the panel copy changed and this parser needs re-anchoring, not deleting`,
  ).not.toBeNull();
  const g = m as RegExpMatchArray;
  const startMinutes = toMinutes(Number(g[2]), Number(g[3]), g[4]);
  const endMinutes = toMinutes(Number(g[5]), Number(g[6]), g[7]);
  return {
    text,
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
    startRow: (startMinutes - START_HOUR * 60) / SLOT_MINUTES,
    // The commit's `end` is the START of the row AFTER the last selected one
    // (`EventScheduler.commitRows`), so the inclusive last row is one back.
    endRow: (endMinutes - START_HOUR * 60) / SLOT_MINUTES - 1,
    dayOfMonth: Number(g[1]),
  };
}

// --- Raw CDP touch primitives ------------------------------------------------

async function touchStart(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
}

async function touchMove(cdp: CDPSession, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
}

async function touchEnd(cdp: CDPSession): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Stepped move — a real drag stream, each step small enough that no row can be
 *  skipped by point resolution. */
async function steppedMoves(
  cdp: CDPSession,
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    await touchMove(cdp, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(30);
  }
}

/** A plain swipe: start, immediate stepped moves (past the slop well before the
 *  long-press timer), end. The browser owns this gesture. */
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

/** Hold past the long-press threshold — enters range/paint mode. */
async function longPress(cdp: CDPSession, page: Page, at: { x: number; y: number }): Promise<void> {
  await touchStart(cdp, at.x, at.y);
  await page.waitForTimeout(LONG_PRESS_HOLD_MS);
}

/** A tap: down then up, well under the threshold, with no movement. */
async function tap(cdp: CDPSession, page: Page, at: { x: number; y: number }): Promise<void> {
  await touchStart(cdp, at.x, at.y);
  await page.waitForTimeout(60);
  await touchEnd(cdp);
}

// =============================================================================

test.describe('Phase 88.1 Req 5 — visual scheduler touch model (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'the long-press touch model is a phone-tenet requirement — phone project only');

  test('(1) a plain drag scrolls the day column and selects nothing', async ({ page }) => {
    await openVisualScheduler(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const corridor = corridorCells(geo);
    expect(
      corridor.length,
      'no grid cell sits inside the drag corridor (visible, clear of both 48px edge bands) — the day column budget shrank below a usable gesture surface; fix the geometry, not this test',
    ).toBeGreaterThanOrEqual(2);

    // Nothing is selected when the modal opens: the prompt copy renders instead
    // of the panel. Proving the NEGATIVE below needs this positive first.
    await expect(selectedTimeLabel(page)).toHaveCount(0);

    const cdp = await page.context().newCDPSession(page);
    const x = corridor[0].cx;
    // Swipe UP from just above the bottom band to just below the top band: the
    // finger moves up, so the column scrolls down.
    await swipe(
      cdp,
      page,
      { x, y: geo.scroller.bottom - EDGE_BAND_PX - 10 },
      { x, y: geo.scroller.top + EDGE_BAND_PX + 10 },
    );

    await expect
      .poll(() => columnScrollTop(page), {
        message:
          'a plain drag on the day column did not scroll it — either a static CSS pan-blocker is back on the grid (threat T-88.1-30) or the Radix dialog is swallowing the pan; both are the defect the CONDITIONAL non-passive touchmove suppressor exists to avoid',
      })
      .toBeGreaterThan(0);
    await expect(
      selectedTimeLabel(page),
      'a plain drag committed a selection — plain drag must SCROLL, not paint (owner ruling 2026-08-02, model (a))',
    ).toHaveCount(0);
  });

  test('(2) a tap selects exactly one slot and the Selected Time panel reflects it', async ({ page }) => {
    await openVisualScheduler(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const corridor = corridorCells(geo);
    expect(corridor.length, 'no cell in the drag corridor to tap').toBeGreaterThanOrEqual(1);
    const target = corridor[1] ?? corridor[0];

    const cdp = await page.context().newCDPSession(page);
    await tap(cdp, page, { x: target.cx, y: target.cy });

    const sel = await readSelection(page);
    expect(
      sel.startRow,
      `a tap on cell ${target.coord} committed a range starting at row ${sel.startRow} ("${sel.text}") — the tap must commit the slot under the finger`,
    ).toBe(target.row);
    expect(
      sel.durationMinutes,
      `a tap committed ${sel.durationMinutes} minutes ("${sel.text}") — a tap is the degenerate one-slot case of the range machine and must commit exactly one ${SLOT_MINUTES}-minute slot`,
    ).toBe(SLOT_MINUTES);
  });

  test('(3) long-press then drag paints a range across the crossed slots', async ({ page }) => {
    await openVisualScheduler(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const corridor = corridorCells(geo);
    expect(
      corridor.length,
      'fewer than 3 cells in the drag corridor — a range drag cannot be distinguished from a tap here',
    ).toBeGreaterThanOrEqual(3);
    const anchor = corridor[0];
    const target = corridor[corridor.length - 1];

    const scrollBefore = await columnScrollTop(page);
    const cdp = await page.context().newCDPSession(page);

    await longPress(cdp, page, { x: anchor.cx, y: anchor.cy });
    await steppedMoves(cdp, page, { x: anchor.cx, y: anchor.cy }, { x: anchor.cx, y: target.cy });

    // The LIVE affordance, read while the finger is still down: the drag
    // rectangle (DECISION Phase 88-27 D-32 bucket A — border only, no fill).
    // Nothing may commit mid-drag, so the panel must still be absent here.
    await expect(
      dialog(page).getByTestId('scheduler-drag-rect'),
      'no live selection rectangle during a paint drag — `onExtend` is not reaching the WeekGrid overlay seam',
    ).toBeVisible();
    await expect(
      selectedTimeLabel(page),
      'the range committed MID-DRAG — `mode: "range"` must commit exactly once, on release',
    ).toHaveCount(0);

    await touchEnd(cdp);

    const sel = await readSelection(page);
    expect(sel.startRow, `range start row ("${sel.text}")`).toBe(anchor.row);
    expect(sel.endRow, `range end row ("${sel.text}")`).toBe(target.row);
    expect(
      sel.durationMinutes,
      `a long-press drag across ${target.row - anchor.row + 1} rows committed only ${sel.durationMinutes} minutes ("${sel.text}") — the range machine collapsed to a single slot`,
    ).toBeGreaterThan(SLOT_MINUTES);

    // The conditional non-passive preventDefault is load-bearing and this is its
    // test: a paint drag entirely inside the corridor must not scroll the column.
    expect(
      await columnScrollTop(page),
      'the day column scrolled during a mid-corridor paint drag — the paint-gated non-passive touchmove preventDefault is not suppressing native scroll',
    ).toBe(scrollBefore);
    await expect(dialog(page).getByTestId('scheduler-drag-rect')).toHaveCount(0);
  });

  test('(4) movement past the slop distance before the threshold cancels the gesture', async ({ page }) => {
    await openVisualScheduler(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const corridor = corridorCells(geo);
    expect(corridor.length, 'no cell in the drag corridor for the slop case').toBeGreaterThanOrEqual(2);
    const anchor = corridor[corridor.length - 1];

    const cdp = await page.context().newCDPSession(page);
    await touchStart(cdp, anchor.cx, anchor.cy);
    // Under the threshold, then a movement comfortably past the slop distance:
    // the machine must hand the gesture back to the browser HERE.
    await page.waitForTimeout(120);
    await steppedMoves(
      cdp,
      page,
      { x: anchor.cx, y: anchor.cy },
      { x: anchor.cx, y: anchor.cy - (SLOP_PX + 100) },
      6,
    );
    // Keep the finger down well PAST the threshold. The distinguishing claim:
    // elapsed time alone must not resurrect a cancelled gesture.
    await page.waitForTimeout(LONG_PRESS_HOLD_MS);
    await steppedMoves(
      cdp,
      page,
      { x: anchor.cx, y: anchor.cy - (SLOP_PX + 100) },
      { x: anchor.cx, y: anchor.cy - (SLOP_PX + 160) },
      4,
    );
    await touchEnd(cdp);

    await expect(
      selectedTimeLabel(page),
      'a gesture that broke slop BEFORE the long-press threshold still painted — slop cancellation is dead, so every attempt to scroll the column will select a time instead',
    ).toHaveCount(0);
    await expect
      .poll(() => columnScrollTop(page), {
        message: 'the cancelled gesture did not become a native scroll — the browser never took the pan back',
      })
      .toBeGreaterThan(0);
  });

  test('(5) edge auto-scroll paints past the visible edge and the page behind the modal stays put', async ({ page }) => {
    await openVisualScheduler(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const corridor = corridorCells(geo);
    expect(corridor.length, 'no cell in the drag corridor to anchor the auto-scroll drag').toBeGreaterThanOrEqual(2);
    const anchor = corridor[0];

    // The row that is the LAST one fully visible at gesture start. Anything past
    // it can only be painted by the rAF loop, which is the whole claim.
    const lastVisibleRow = Math.max(...geo.visible.map((c) => c.row));
    expect(
      lastVisibleRow,
      'every one of the 28 rows is already visible — the day column is not height-bounded, so the auto-scroll case is untestable; fix PHONE_GRID_MAX_HEIGHT, not this test',
    ).toBeLessThan(geo.cells.length - 1);

    const pageScrollBefore = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);

    await longPress(cdp, page, { x: anchor.cx, y: anchor.cy });
    // Drag into the BOTTOM edge band of the scroll container, then hold: the
    // finger is stationary from here, so no pointermove fires and the rAF tick
    // has to drive both the scroll AND the paint.
    const bandY = geo.scroller.bottom - 12;
    await steppedMoves(cdp, page, { x: anchor.cx, y: anchor.cy }, { x: anchor.cx, y: bandY });

    await expect
      .poll(() => columnScrollTop(page), {
        message:
          'holding in the bottom edge band did not scroll the DAY COLUMN — the hook\'s documented default scrolls the WINDOW, which inside a Radix dialog either does nothing or moves the page behind it (RESEARCH C10 / pitfall P4); the scheduler must override both axes',
        timeout: 10_000,
      })
      .toBeGreaterThan(150);

    await touchEnd(cdp);

    const sel = await readSelection(page);
    expect(
      sel.endRow,
      `the auto-scroll drag committed rows ${sel.startRow}-${sel.endRow} ("${sel.text}") but row ${lastVisibleRow} was the last one visible when the gesture started — the loop scrolled without painting the newly revealed cells (a stationary finger fires no pointermove, so the rAF tick must re-resolve at the last-known coords)`,
    ).toBeGreaterThan(lastVisibleRow);
    expect(sel.startRow, `the anchor row moved during the auto-scroll ("${sel.text}")`).toBe(anchor.row);

    // The C10 regression guard, observed from OUTSIDE: a page-level scroll would
    // move the surface behind the dialog.
    expect(
      await page.evaluate(() => window.scrollY),
      'the page BEHIND the modal scrolled during an edge-band paint — the edge auto-scroll is pointed at the window instead of the grid container',
    ).toBe(pageScrollBefore);

    // Release tears the loop down: the column must stop moving.
    const settled = await columnScrollTop(page);
    await page.waitForTimeout(200);
    expect(
      await columnScrollTop(page),
      'the day column kept scrolling after touchEnd — the rAF edge loop was not cancelled on release',
    ).toBe(settled);
  });

  test('(6) tapping a strip cell changes which day the column shows', async ({ page }) => {
    await openVisualScheduler(page);

    const tabs = dialog(page).getByRole('tab');
    await guardResolved(tabs, 'the phone week strip\'s day tabs (SchedulerWeekStrip)', 7);
    expect(
      await tabs.count(),
      'the phone week strip must render exactly 7 day tabs — Req 7\'s week-at-a-glance is the whole reason the strip exists',
    ).toBe(7);

    const header = dialog(page).getByRole('columnheader');
    expect(
      await header.count(),
      'the phone arm must render exactly ONE day column (Req 7 / D-04) — more than one means the md fork did not apply',
    ).toBe(1);
    const before = ((await header.textContent()) ?? '').trim();

    // Pick a tab that is NOT the selected one, so the assertion has somewhere to move.
    let targetIndex = -1;
    for (let i = 0; i < 7; i++) {
      if ((await tabs.nth(i).getAttribute('aria-selected')) !== 'true') {
        targetIndex = i;
        break;
      }
    }
    expect(
      targetIndex,
      'every strip tab reports aria-selected="true" — the strip cannot express which day the column is showing',
    ).toBeGreaterThanOrEqual(0);

    const targetTab = tabs.nth(targetIndex);
    // The tab's accessible name is `${format(date,'EEEE d')}, ${availability}` —
    // "Wednesday 22, 3 of 4 available" — so the day it stands for is readable
    // from the name rather than from any class or index arithmetic.
    const label = (await targetTab.getAttribute('aria-label')) ?? '';
    const nameMatch = label.match(/^([A-Za-z]+) (\d{1,2}),/);
    expect(
      nameMatch,
      `strip tab ${targetIndex} has accessible name "${label}", which does not match the "EEEE d, <availability>" shape — the name changed and this parser needs re-anchoring`,
    ).not.toBeNull();
    const [, weekday, dayNumber] = nameMatch as RegExpMatchArray;

    const box = await targetTab.boundingBox();
    expect(box, `strip tab ${targetIndex} has no boundingBox`).not.toBeNull();
    const cdp = await page.context().newCDPSession(page);
    await tap(cdp, page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });

    // WeekGrid renders day headers as `dd EEE` ("22 Wed") — plan 88.1-07's
    // uneditable Layer-3 contract, so this is the shape to expect.
    const expected = `${dayNumber.padStart(2, '0')} ${weekday.slice(0, 3)}`;
    await expect(
      header,
      `tapping the "${label}" strip tab did not move the day column (was "${before}") — a strip tap must route through navigateTo`,
    ).toHaveText(expected);
    await expect(targetTab).toHaveAttribute('aria-selected', 'true');
  });

  test('(7) Req 1: a slot picked by GESTURE round-trips visual -> manual -> visual', async ({ page }) => {
    // REQUIRED, not optional — see the file header. Plan 88.1-07's SUMMARY
    // (deviation 1) records that the gesture-originated half of the Phase 66-01
    // round-trip could not be driven in jsdom and routed it here. If this case is
    // ever deleted, Req 1 has no owner at all.
    await openVisualScheduler(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const corridor = corridorCells(geo);
    expect(corridor.length, 'no cell in the drag corridor for the round-trip case').toBeGreaterThanOrEqual(2);
    const target = corridor[1] ?? corridor[0];

    // (a) VISUAL: a real touch gesture writes the parent's canonical fields.
    const cdp = await page.context().newCDPSession(page);
    await tap(cdp, page, { x: target.cx, y: target.cy });
    const visual = await readSelection(page);
    expect(visual.startRow, `the gesture selected row ${visual.startRow}, expected ${target.row}`).toBe(target.row);

    // (b) MANUAL: the SAME canonical fields, read through the manual controls.
    // The parent owns start_date + duration_minutes; the scheduler is controlled
    // and holds no selection state of its own (Phase 66-01). The two mode
    // controls are one button whose copy flips — "Switch to Manual Entry" /
    // "Switch to Visual Calendar" (createEvent.js:961) — located here by
    // case-insensitive accessible name, the idiom create-event.spec.ts:33 uses.
    await dialog(page).getByRole('button', { name: /switch to manual entry/i }).click();
    const startInput = dialog(page).getByLabel(/start date & time/i);
    await guardResolved(startInput, 'the manual start date/time input');
    const raw = await startInput.inputValue();
    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
    expect(
      isoMatch,
      `the manual start input holds "${raw}", not a "YYYY-MM-DDTHH:mm" value — the gesture did not reach the parent's canonical start_date`,
    ).not.toBeNull();
    const [, isoDate, hh, mm] = isoMatch as RegExpMatchArray;
    expect(
      Number(hh) * 60 + Number(mm),
      `the manual input reads ${hh}:${mm} but the visual panel showed "${visual.text}" — visual and manual are not reading the same canonical field`,
    ).toBe(visual.startMinutes);
    expect(
      Number(isoDate.slice(8, 10)),
      `the manual input's date ${isoDate} disagrees with the visual panel's day (${visual.dayOfMonth}) — "${visual.text}"`,
    ).toBe(visual.dayOfMonth);

    const durationInput = dialog(page).getByPlaceholder(/enter duration in minutes/i);
    await guardResolved(durationInput, 'the manual duration input');
    expect(
      Number(await durationInput.inputValue()),
      `the manual duration disagrees with the visual panel's range ("${visual.text}")`,
    ).toBe(visual.durationMinutes);

    // (c) BACK TO VISUAL: the panel is repopulated from that same parent state.
    // A scheduler holding its own copy of the selection would show a stale value
    // here, or nothing at all.
    await dialog(page).getByRole('button', { name: /switch to visual calendar/i }).click();
    const roundTripped = await readSelection(page);
    expect(
      roundTripped.text,
      `the "Selected Time:" panel came back as "${roundTripped.text}" after a visual -> manual -> visual round-trip, was "${visual.text}" — the scheduler is not a pure projection of the parent's canonical fields (Phase 66-01)`,
    ).toBe(visual.text);
  });
});

// =============================================================================

test.describe('Phase 88.1 Req 5 — visual scheduler mouse range-select (desktop project)', () => {
  // INVERSE of the guard above. Mouse drag-select is the one capability the
  // removed calendar library supplied for free (`selectable` + `onSelectSlot`);
  // `usePaintGesture`'s `mode: 'range'` is its replacement and nothing else
  // exercises it end to end. It only exists at desktop width, where the
  // seven-column grid renders.
  test.skip(({ isMobile }) => isMobile, 'mouse range-select is a desktop-arm mechanism — desktop project only');

  test('a mouse drag commits ONE range, on the anchor\'s day column only', async ({ page }) => {
    await openVisualScheduler(page);
    // The modal body scrolls independently; bring the grid's top into view before
    // measuring, or every cell rect is outside the viewport and unresolvable.
    await dialog(page).getByRole('columnheader').first().scrollIntoViewIfNeeded();
    await resetColumnScroll(page);

    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    const headers = dialog(page).getByRole('columnheader');
    expect(
      await headers.count(),
      'the desktop arm must render seven day columns (SPEC Req 2 — week and day are one code path parameterized by `days`)',
    ).toBe(7);

    const anchorCol = 1;
    const targetCol = 3;
    const anchorColumn = corridorCells(geo, anchorCol);
    const targetColumn = corridorCells(geo, targetCol);
    expect(
      Math.min(anchorColumn.length, targetColumn.length),
      'fewer than 3 corridor cells in the columns this case drags between — the grid is not tall enough in view to distinguish a range from a tap',
    ).toBeGreaterThanOrEqual(3);

    const anchor = anchorColumn[0];
    const target = targetColumn[targetColumn.length - 1];

    await page.mouse.move(anchor.cx, anchor.cy);
    await page.mouse.down();
    // Diagonal on purpose: rows AND columns. A mouse engages immediately (no
    // long-press), so this is the full range machine in one gesture.
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        anchor.cx + ((target.cx - anchor.cx) * i) / 10,
        anchor.cy + ((target.cy - anchor.cy) * i) / 10,
      );
    }
    await expect(
      dialog(page).getByTestId('scheduler-drag-rect'),
      'no live selection rectangle during a mouse drag — the range machine never engaged on the mouse arm',
    ).toBeVisible();
    await page.mouse.up();

    const sel = await readSelection(page);
    expect(
      sel.durationMinutes,
      `a mouse drag across ${target.row - anchor.row + 1} rows committed ${sel.durationMinutes} minutes ("${sel.text}") — mouse drag-select collapsed to a single slot, which is exactly the capability the calendar library used to supply`,
    ).toBeGreaterThan(SLOT_MINUTES);
    expect(sel.startRow, `mouse range start row ("${sel.text}")`).toBe(anchor.row);
    expect(sel.endRow, `mouse range end row ("${sel.text}")`).toBe(target.row);

    // DECISION Phase 88.1-11 (range shape): a drag commits on the ANCHOR's day
    // column with only the ROWS normalized. A cross-day pair would reach the
    // parent as a duration measured in days, which the 1-720 minute manual field
    // it round-trips through cannot express (threat T-88.1-29).
    const anchorHeader = ((await headers.nth(anchorCol).textContent()) ?? '').trim();
    const targetHeader = ((await headers.nth(targetCol).textContent()) ?? '').trim();
    expect(
      sel.dayOfMonth,
      `a drag anchored in the "${anchorHeader}" column and released in the "${targetHeader}" column committed day ${sel.dayOfMonth} ("${sel.text}") — a horizontal drag must NOT span days`,
    ).toBe(Number(anchorHeader.slice(0, 2)));
  });
});
