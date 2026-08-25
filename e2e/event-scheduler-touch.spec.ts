import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';
// Plan 88.1-19 MEASUREMENT instruments — read-only, and deliberately NOT a spec file, so
// Playwright's default testMatch cannot collect it as a suite. Every call below is an
// attachment; none of them asserts anything. See `e2e/support/diagnostics.ts`.
import {
  attachDiagnostics,
  formChildDeltas,
  probeFormChildHeights,
  probePointPath,
  probeSchedulerGeometry,
  probeViewport,
} from './support/diagnostics';

/** Arm-trace sample collected in-page by the plan 88.1-12 deviation-3 flash probe. */
interface ArmSample {
  t: number;
  headers: number;
  tabs: number;
  toggle: number;
}

declare global {
  interface Window {
    __schedulerArmTrace?: ArmSample[];
  }
}

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

/* DECISION Phase 88.1-21 (88.1-CODE-REVIEW.md): NO `?? '1'` fallback here, chosen OVER keeping
   one for local convenience. Every scheduler case in this file leans on the fixture-owned
   availability invariant (the non-vacuity guard below names its two owners); a job that failed
   to export the fixture id would silently drive group '1' instead, decoupled from that
   invariant, and go green for the wrong reason. The empty-string default keeps the type
   `string` so every template interpolation below still typechecks, and the beforeEach turns an
   unset var into one loud, self-explaining failure instead of a mystery. Scoped to THIS file
   deliberately — other specs' `?? '1'` is a separate decision with a separate owner. */
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

// Repo idiom (e2e/auth.setup.ts:31-33): assert, name the var and its producer, never echo the
// value. File-scope so all three test.describe blocks below are covered.
test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it every scheduler case in this file reads a group the fixtures do not own, and its availability assertions prove nothing.',
  ).toBeTruthy();
});

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
  /** Cells fully inside the REACHABLE band below — the only ones
   *  `document.elementFromPoint` (and therefore `usePaintGesture`) can resolve. */
  visible: CellBox[];
  /**
   * The band a finger can actually land in: the scroller's rect INTERSECT every clipping
   * ancestor INTERSECT the viewport.
   *
   * The clip chain is the load-bearing half and it used to be missing (plan 88.1-19, run
   * 32774690333). At 375x667 this band measured `368.352 .. 632.648` while a viewport-only
   * clamp gave `368.352 .. 667` — so the old filter admitted FIVE cells where only FOUR were
   * reachable, and a drag to the fifth landed on the Radix backdrop
   * (`div.fixed inset-0 z-50 bg-black/80`, `elementFromPoint` -> null). The modal is
   * `max-h-[90vh] overflow-hidden`; the viewport is not the clip.
   */
  visibleBand: { top: number; bottom: number; height: number };
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
    // Every clipping ancestor between the scroller and <body>. This walk is lifted from
    // `probeSchedulerGeometry` (e2e/support/diagnostics.ts) rather than re-derived, so the
    // spec helper and the diagnostic probe can never disagree about the same box — plan 19
    // compared them side by side precisely because they DID disagree.
    let vTop = Math.max(sr.top, 0);
    let vBottom = Math.min(sr.bottom, window.innerHeight);
    for (let node = scroller.parentElement; node && node !== document.body; node = node.parentElement) {
      const cs = window.getComputedStyle(node);
      if (cs.overflow !== 'visible' || cs.overflowY !== 'visible') {
        const cr = node.getBoundingClientRect();
        vTop = Math.max(vTop, cr.top);
        vBottom = Math.min(vBottom, cr.bottom);
      }
    }
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
      visibleBand: { top: vTop, bottom: vBottom, height: vBottom - vTop },
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
 * Wait until the open dialog has stopped MOVING THE GRID, so every coordinate computed from
 * `gridGeometry` below is computed against the layout the gesture will actually meet.
 *
 * WHY THIS EXISTS (plan 88.1-19 measured it, runs 32773229213 and 32774690333). The create-event
 * form GROWS by exactly 62px above the scheduler while a gesture is in flight — phone
 * `contentOffsetTopInClip` 273 -> 335 and form height 1195 -> 1257, desktop 195 -> 257 and
 * 1392 -> 1454, with the modal body's `scrollTop` pinned at 0 throughout, so this is content
 * growing and categorically not a container scrolling. Row pitch is 57px desktop / 49px phone,
 * so 62px is just over ONE ROW: the drag cases computed their target coordinate before the
 * growth and dispatched the finger there after it, and committed one row short (desktop endRow
 * 4 for 5, phone 2 for 3). The grower is async content above `<EventScheduler>`; the PRODUCT
 * side of that — a grid that jumps under a user's finger — is routed to Phase 88.6 by owner
 * ruling D-12 and is deliberately NOT fixed here.
 *
 * THIS IS A PRECONDITION, NOT THE FIX. The fix is `steppedMovesToCell` / `mouseMovesToCell`,
 * which re-resolve the target LIVE on every step and therefore track a shift whenever it
 * happens. This settle is what keeps that chase REACHABLE: measured on the phone arm, the last
 * corridor cell sat 35.7px clear of the clipped box's bottom (cell bottom 596.9 vs band bottom
 * 632.648), so a 62px shift carried it OUT of the modal's `overflow-hidden` box entirely and no
 * amount of live tracking could have put a finger on it. Measure after the growth, then chase
 * anything left. Two layers, and they fail independently.
 *
 * Case 5 needs it for a second reason: `getBounds` returns the scroller's UNCLIPPED rect, so a
 * 62px shift moves the hook's edge band down 62px while the clip stays put — post-shift, the
 * intersection its `bandY` lives in is EMPTY. A stale bandY there reproduces the 0px auto-scroll
 * that plan 19 diagnosed, with a different cause and the same red.
 *
 * Two gates, because either alone can lie:
 *   1. the Web Animations API — the Radix `zoom-in-95 / duration-200` open animation moves the
 *      whole dialog (`src/components/ui/dialog.tsx`), and `toBeVisible()` resolves at its START.
 *      Infinite animations (spinners) are excluded or this would never resolve.
 *   2. a stability poll on the grid scroller's own top edge and the form's height. The window is
 *      deliberately LONGER than the 500ms debounce the known grower fires on: four identical
 *      samples 250ms apart is >= 750ms of quiet. A shorter window would go green in the gap
 *      BEFORE the late content lands, which is the exact race this helper exists to close.
 */
const SETTLE_SAMPLES = 4;

async function settleSchedulerGeometry(page: Page): Promise<void> {
  await dialog(page)
    .first()
    .evaluate(async (el) => {
      const running = (el as HTMLElement)
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity);
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
    });

  const sample = () =>
    page.evaluate(() => {
      const round = (n: number) => Math.round(n * 1000) / 1000;
      const grid = document.querySelector('[role="dialog"] [role="grid"]');
      const scroller = grid?.parentElement as HTMLElement | null;
      if (!scroller) return 'no-scroller';
      const r = scroller.getBoundingClientRect();
      const form = document.querySelector('[role="dialog"] form') as HTMLElement | null;
      const fh = form ? round(form.getBoundingClientRect().height) : -1;
      return [round(r.top), round(r.height), fh].join('/');
    });

  const history: string[] = [];
  await expect
    .poll(
      async () => {
        history.push(await sample());
        if (history.length > SETTLE_SAMPLES) history.shift();
        return (
          history.length === SETTLE_SAMPLES &&
          history.every((h) => h === history[0] && h !== 'no-scroller')
        );
      },
      {
        message:
          'the scheduler grid never stopped moving inside the dialog — something above it is still growing or animating after ~750ms of quiet. Every coordinate this case computes would be stale before it is dispatched (plan 88.1-19 measured a 62px shift doing exactly that). Find the grower with `probeFormChildHeights`; do NOT delete this wait and do NOT relax a row expectation to match a moved grid.',
        timeout: 15_000,
        intervals: [250],
      },
    )
    .toBe(true);
}

/**
 * Scroll the MODAL BODY until the grid scroller's bottom edge sits inside the modal's visible
 * box — the thing a real user does before they can put a finger in the column's bottom edge band.
 *
 * WHY THIS IS NEEDED AT ALL (measured, run 32783377133, on the settled layout). The grid's
 * scroll container is TALLER than the modal's visible box and hangs below it: scroller
 * [430.352, 735.352] against a clipped box of [430.352, 632.648]. `getBounds`
 * (`EventScheduler.tsx`) hands `usePaintGesture` the scroller's UNCLIPPED rect, so the bottom
 * edge band the rAF loop watches is [687.352, 735.352] — 54.7px BELOW the last pixel a finger
 * can touch. There is no coordinate that is both on the grid and in the edge band until the
 * modal body is scrolled, which is exactly what case 5's guard reported.
 *
 * This is a real user action, not a measurement convenience: the create-event form is long and
 * its body scrolls. It is also the honest way to test the claim — auto-scroll must work when the
 * edge band is ON SCREEN. Relaxing the guard, widening EDGE_BAND_PX, or inventing a coordinate
 * outside the clip would each be "fix the spec until it passes", which this plan forbids.
 *
 * Scrolls the nearest clipping ancestor only, by the exact overhang plus an 8px margin, and
 * never past its own max. Geometry MUST be re-read after this call — the grid moves.
 */
async function revealGridBottomEdge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const grid = document.querySelector('[role="dialog"] [role="grid"]');
    const scroller = grid?.parentElement as HTMLElement | null;
    if (!scroller) return;
    for (let node = scroller.parentElement; node && node !== document.body; node = node.parentElement) {
      const cs = window.getComputedStyle(node);
      if (cs.overflow === 'visible' && cs.overflowY === 'visible') continue;
      const overhang = scroller.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
      if (overhang > 0) {
        node.scrollTop = Math.min(node.scrollTop + overhang + 8, node.scrollHeight - node.clientHeight);
      }
      return;
    }
  });
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

/** Live centre of one grid cell, read by its `data-coord` at the moment of the call.
 *  Scoped to the open dialog because `EventHeatmapBackground` mounts a second WeekGrid
 *  on the page behind the modal. */
async function cellCentre(page: Page, coord: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((wanted) => {
    const el = document.querySelector(
      '[role="dialog"] [role="grid"] [data-coord="' + wanted + '"]',
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, coord);
}

/**
 * Drag to a CELL rather than to a coordinate — the target is re-resolved LIVE on every step.
 *
 * DECISION Phase 88.1-20 (item A, owner ruling D-12 / plan 88.1-19 verdict row A): the drag
 * cases track the target cell's CURRENT position, chosen OVER dispatching a coordinate computed
 * once before the gesture. Plan 19 measured why: the create-event form grows 62px above the grid
 * mid-gesture (phone `contentOffsetTopInClip` 273 -> 335, desktop 195 -> 257, `scrollTop` 0
 * throughout), which is just over one row at both pitches, and the pre-computed coordinate then
 * pointed at the row ABOVE the intended one — desktop `652` resolved to `4:3` when the target was
 * `5:3`, phone `572.420` resolved to `2:0` when the target was `3:0`. The commits were `endRow` 4
 * for 5 and 2 for 3: the range machine was doing exactly what the finger told it.
 *
 * Rejected alternative 1 — WAIT for the form to settle and keep dispatching fixed coordinates.
 * That is a timing heuristic against ONE known grower: it closes the shift that finishes before
 * the gesture and is blind to any shift that starts after it (`QuickSuggestions`' deps
 * `[groupId, playerCount, duration]` can re-fire mid-session, and nothing stops the next async
 * block above the grid from landing later still). A live chase does not care WHEN, WHY or HOW
 * MANY times the layout moves. `settleSchedulerGeometry` is still called first, but as this
 * helper's PRECONDITION, not as the fix — see its own header for the 35.7px-vs-62px reason.
 *
 * Rejected alternative 2 — relax the row expectation to whatever landed. That is the "fix a spec
 * until it passes" move plan 88.1-20 forbids outright; `endRow` is the assertion the case exists
 * for.
 *
 * Each step closes the REMAINING distance to the live centre, so the last step lands exactly on
 * it however far the grid moved in between, and the steps stay small enough that no row is
 * skipped by point resolution. Returns the path actually dispatched — the caller reports THAT,
 * never a formula, because with a live chase no formula reproduces it.
 */
async function steppedMovesToCell(
  cdp: CDPSession,
  page: Page,
  from: { x: number; y: number },
  coord: string,
  steps = 12,
): Promise<{ x: number; y: number }[]> {
  const path: { x: number; y: number }[] = [];
  let cur = { ...from };
  for (let i = 1; i <= steps; i++) {
    const live = must(await cellCentre(page, coord), `the live centre of cell ${coord} on step ${i}`);
    const remaining = steps - i + 1;
    cur = {
      x: cur.x + (live.x - cur.x) / remaining,
      y: cur.y + (live.y - cur.y) / remaining,
    };
    await touchMove(cdp, cur.x, cur.y);
    path.push({ ...cur });
    await page.waitForTimeout(30);
  }
  return path;
}

/** The mouse arm of `steppedMovesToCell` — same live re-resolution, same reason. */
async function mouseMovesToCell(
  page: Page,
  from: { x: number; y: number },
  coord: string,
  steps = 10,
): Promise<{ x: number; y: number }[]> {
  const path: { x: number; y: number }[] = [];
  let cur = { ...from };
  for (let i = 1; i <= steps; i++) {
    const live = must(await cellCentre(page, coord), `the live centre of cell ${coord} on step ${i}`);
    const remaining = steps - i + 1;
    cur = {
      x: cur.x + (live.x - cur.x) / remaining,
      y: cur.y + (live.y - cur.y) / remaining,
    };
    await page.mouse.move(cur.x, cur.y);
    path.push({ ...cur });
  }
  return path;
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
    await settleSchedulerGeometry(page);
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
    /* Swipe UP from the LOWEST corridor cell to the highest: the finger moves up, so the
       column scrolls down.

       These endpoints used to be `geo.scroller.bottom - EDGE_BAND_PX - 10` and
       `geo.scroller.top + EDGE_BAND_PX + 10` — arithmetic on the UNCLIPPED scroller rect,
       which is the same defect plan 88.1-19 measured in case 5 (verdict row B). It went
       unnoticed because the case ran BEFORE the form's 62px growth landed; with
       `settleSchedulerGeometry` in front of it the growth lands first, the scroller's rect
       bottom moves to 735.352 while the modal still clips at 632.648, and the finger started
       102.7px below the reachable box — on the Radix backdrop, scrolling nothing (measured,
       run 32783377133).

       Corridor cells are already filtered to the reachable box AND clear of both edge bands,
       so taking the endpoints from them cannot reproduce this. Do not reintroduce rect
       arithmetic here: `scroller.bottom` is not where the grid ends on screen. */
    await swipe(
      cdp,
      page,
      { x, y: corridor[corridor.length - 1].cy },
      { x, y: corridor[0].cy },
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
    await settleSchedulerGeometry(page);
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

  test('(3) long-press then drag paints a range across the crossed slots', async ({ page }, testInfo) => {
    await openVisualScheduler(page);

    // D-12 PROBE, half one of two (owner ruling 2026-08-24). Sampled BEFORE the settle below,
    // so the pair brackets the growth plan 19 measured but could not attribute: 19's probe
    // stopped at the single `<form class="space-y-4">` and could not point inside it. Read-only,
    // asserts nothing. See `probeFormChildHeights` for why this is still wired after the spec fix.
    const formChildrenAtOpen = await probeFormChildHeights(page);

    await settleSchedulerGeometry(page);
    await resetColumnScroll(page);
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");

    // D-12 PROBE, half two: the same children after the layout has settled. The child whose
    // `heightDelta` is ~62 IS the grower — the identity Phase 88.6's deferred entry currently
    // names by INSPECTION (`QuickSuggestions`), which the Evidence Rule does not accept.
    const formChildrenSettled = await probeFormChildHeights(page);
    await attachDiagnostics(testInfo, 'case3-form-growth', {
      note: 'per-child height delta of the create-event form between dialog open and layout settle. The ~62px row names the element that shifts the grid under the user (Phase 88.6 deferred entry). MEASUREMENT ONLY.',
      deltas: formChildDeltas(formChildrenAtOpen, formChildrenSettled),
      atOpen: formChildrenAtOpen,
      settled: formChildrenSettled,
    });

    // MEASUREMENT ONLY (plan 88.1-19). Read-only: no scroll, no click, no style write.
    // Kept after the fix on purpose (T-88.1-64): these numbers are what turned this case's
    // triage from three plausible stories into one measured one, and they will attach fresh
    // numbers to whatever the NEXT red run is. Do not turn any of it into an assertion.
    await attachDiagnostics(testInfo, 'case3-pre-drag', {
      viewport: await probeViewport(page),
      geometry: await probeSchedulerGeometry(page),
      specHelperBand: {
        note: 'gridGeometry\'s own numbers. `visibleBand` now intersects the clip chain, so it should match geometry.clippedVisibleBand and NOT geometry.specVisibleBand.',
        scroller: geo.scroller,
        visibleBand: geo.visibleBand,
        visibleCount: geo.visible.length,
        cellCount: geo.cells.length,
        gridCount: geo.gridCount,
      },
    });

    const corridor = corridorCells(geo);
    expect(
      corridor.length,
      `fewer than 3 cells in the drag corridor — a range drag cannot be distinguished from a tap here. The reachable box (scroller INTERSECT every clip INTERSECT viewport) is [${geo.visibleBand.top}, ${geo.visibleBand.bottom}] = ${geo.visibleBand.height}px tall and holds ${geo.visible.length} of ${geo.cells.length} cells; the corridor then drops ${EDGE_BAND_PX + 4}px at each end so the rAF auto-scroll loop cannot engage. Fix the GEOMETRY or the viewport, never this number.`,
    ).toBeGreaterThanOrEqual(3);

    // POSITIVE CONTROL for the clip-chain intersection added in `gridGeometry`. An
    // over-tight band would empty the corridor and fail the guard above with a message
    // about the GRID when the defect was in the FILTER — so prove the filter is sane here.
    expect(geo.visible.length, 'the reachable-cell filter returned NOTHING — the clip-chain intersection is over-tight (or the grid is genuinely off screen), and every coordinate below would be invented').toBeGreaterThan(0);
    for (const c of geo.visible) {
      expect(
        c.cy >= geo.visibleBand.top && c.cy <= geo.visibleBand.bottom,
        `cell ${c.coord} passed the reachable filter with centre ${c.cy} outside the reachable box [${geo.visibleBand.top}, ${geo.visibleBand.bottom}]`,
      ).toBe(true);
    }

    const anchor = corridor[0];
    const target = corridor[corridor.length - 1];

    const scrollBefore = await columnScrollTop(page);
    const cdp = await page.context().newCDPSession(page);

    await longPress(cdp, page, { x: anchor.cx, y: anchor.cy });
    // Live re-resolution per step — see `steppedMovesToCell` for the measurement that
    // selected this over a coordinate computed once before the gesture.
    const dragPath = await steppedMovesToCell(cdp, page, { x: anchor.cx, y: anchor.cy }, target.coord);

    // MEASUREMENT ONLY — the finger is still down here, which is the only moment the
    // mid-gesture state is observable. `dragPath` is the path ACTUALLY dispatched (the chase
    // makes any recomputed formula wrong), so each point can be compared against what was
    // under it. `formGrowthDuringGesture` should now be all-zero deltas: a non-zero row here
    // means content moved DURING the drag, which the chase absorbs and this line records.
    await attachDiagnostics(testInfo, 'case3-mid-drag', {
      anchor: { coord: anchor.coord, row: anchor.row, col: anchor.col, cx: anchor.cx, cy: anchor.cy },
      target: { coord: target.coord, row: target.row, col: target.col, cx: target.cx, cy: target.cy },
      corridor: corridor.map((c) => ({ coord: c.coord, row: c.row, cy: c.cy })),
      edgeBandPx: EDGE_BAND_PX,
      dragPath: await probePointPath(page, dragPath),
      formGrowthDuringGesture: formChildDeltas(formChildrenSettled, await probeFormChildHeights(page)),
      geometry: await probeSchedulerGeometry(page),
    });

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
    await settleSchedulerGeometry(page);
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

  test('(5) edge auto-scroll paints past the visible edge and the page behind the modal stays put', async ({ page }, testInfo) => {
    await openVisualScheduler(page);
    await settleSchedulerGeometry(page);
    // Bring the column's bottom edge on screen FIRST — see `revealGridBottomEdge`. Every
    // number below is read after it, because the grid moves.
    await revealGridBottomEdge(page);
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
    const preDragGeometry = await probeSchedulerGeometry(page);

    /* B1 RESOLVED BY MEASUREMENT (plan 88.1-19, run 32774690333). This USED TO read
       `geo.scroller.bottom - 12`, off the UNCLIPPED scroller rect, which put the finger at
       y=661.352 when the modal's reachable box ended at 632.648 — 28.704px outside it. What was
       actually under the finger there was `div.fixed inset-0 z-50 bg-black/80`, the Radix dialog
       BACKDROP, and `elementFromPoint` resolved to null. With no document-level `pointermove`
       (`usePaintGesture.ts:503-504`) `st.lastY` could never reach an edge position, so the rAF
       edge loop never engaged and the column moved 0px. The IMPLEMENTATION was exonerated by the
       same measurement (B2 refuted): the finger simply never landed on the grid.

       The target must sit inside BOTH boxes, and they are different boxes:
         - the CLIPPED band — where a finger can land at all (the modal is `overflow-hidden`);
         - the hook's own edge band — `getBounds` (`EventScheduler.tsx`) returns the scroller's
           UNCLIPPED rect, so the band the loop watches is `scroller.bottom - EDGE_BAND_PX`
           upward from the scroller's real bottom, which extends past the clip.
       Their intersection is the only window where a finger both lands on the grid AND reads as
       "in the edge band". Measured, that window was [625.352, 632.648] — about 7px — so the old
       12px inset from the CLIPPED bottom would still have missed it by ~4.7px. Take the MIDDLE
       of the intersection rather than an inset from either edge. */
    const clippedBand = must(preDragGeometry, "the scheduler's clipped geometry").clippedVisibleBand;
    const bandLo = Math.max(clippedBand.top, geo.scroller.bottom - EDGE_BAND_PX);
    const bandHi = Math.min(clippedBand.bottom, geo.scroller.bottom);
    const bandY = (bandLo + bandHi) / 2;

    /* GUARD, so a future geometry change fails loudly HERE instead of silently reproducing the
       0px scroll as an inscrutable auto-scroll failure. */
    expect(
      bandHi - bandLo,
      `the clipped grid box [${clippedBand.top}, ${clippedBand.bottom}] and the hook's edge band [${geo.scroller.bottom - EDGE_BAND_PX}, ${geo.scroller.bottom}] no longer overlap by a usable margin (${bandHi - bandLo}px). There is no coordinate at which a finger both lands on the grid AND reads as in the edge band, so this case cannot drive the rAF loop. Fix the GEOMETRY (or EDGE_BAND_PX), never this number.`,
    ).toBeGreaterThanOrEqual(4);
    expect(
      bandY,
      `the auto-scroll target ${bandY} is outside the reachable clipped box [${clippedBand.top}, ${clippedBand.bottom}] — the finger would land on the Radix backdrop, exactly the plan-19 defect this line was rewritten to fix`,
    ).toBeLessThanOrEqual(clippedBand.bottom);
    expect(bandY).toBeGreaterThanOrEqual(geo.scroller.bottom - EDGE_BAND_PX);
    await attachDiagnostics(testInfo, 'case5-pre-drag', {
      bandY,
      edgeBandPx: EDGE_BAND_PX,
      specScrollerBottom: geo.scroller.bottom,
      clippedVisibleBandBottom: preDragGeometry?.clippedVisibleBand.bottom ?? null,
      bandYInsideClippedBand:
        preDragGeometry !== null &&
        bandY >= preDragGeometry.clippedVisibleBand.top &&
        bandY <= preDragGeometry.clippedVisibleBand.bottom,
      anchor: { coord: anchor.coord, row: anchor.row, cx: anchor.cx, cy: anchor.cy },
      lastVisibleRow,
      scrollTopBefore: await columnScrollTop(page),
      whatIsAtBandY: await probePointPath(page, [{ x: anchor.cx, y: bandY }]),
      viewport: await probeViewport(page),
      geometry: preDragGeometry,
    });

    await steppedMoves(cdp, page, { x: anchor.cx, y: anchor.cy }, { x: anchor.cx, y: bandY });

    // MEASUREMENT ONLY — emitted BEFORE the poll below, deliberately. The poll THROWS on
    // failure, so anything attached after it would never run on exactly the run this plan
    // exists to measure. The 1.5s hold gives the rAF edge loop the same window the poll
    // would have given it, so "the column moved 0px" becomes a measured number instead of
    // an inference. The finger stays down throughout; nothing here interacts with the page.
    await attachDiagnostics(testInfo, 'case5-in-band', {
      bandY,
      scrollTopOnArrival: await columnScrollTop(page),
      whatIsUnderTheFinger: await probePointPath(page, [{ x: anchor.cx, y: bandY }]),
    });
    await page.waitForTimeout(1500);
    await attachDiagnostics(testInfo, 'case5-after-hold', {
      bandY,
      scrollTopAfter1500msHold: await columnScrollTop(page),
      pageScrollYAfterHold: await page.evaluate(() => window.scrollY),
      pageScrollYBefore: pageScrollBefore,
      whatIsUnderTheFinger: await probePointPath(page, [{ x: anchor.cx, y: bandY }]),
      geometry: await probeSchedulerGeometry(page),
    });

    await expect
      .poll(() => columnScrollTop(page), {
        message:
          'holding in the bottom edge band did not scroll the DAY COLUMN. The finger IS on the grid and IS inside the hook\'s edge band (both asserted above), so the rAF edge loop should be ticking: look at `scrollVerticalBy`/`getBounds` (EventScheduler.tsx) and `maybeRunEdgeLoop` (usePaintGesture.ts). NOTE FOR THE NEXT READER: this message used to blame the hook\'s documented default (a window-level scroll) for the failure, which the scheduler\'s own overrides disprove and plan 88.1-19 measured false (pageScrollY 0 -> 0 across a 1500ms hold). The real 0px reading in CI was a SPEC defect — the target coordinate sat 28.7px outside the clipped modal box, on the Radix backdrop — and it is fixed at the bandY computation above, not here.',
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
    await settleSchedulerGeometry(page);
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

/**
 * MEASURED GEOMETRY AT 375x667 — the C6 coverage gap plan 88.1-02 handed forward
 * IN WRITING, and the second half of plan 88.1-12's deviation 4.
 *
 * Every number the phone arm is built on — 46.7px strip cells against the 44px
 * floor, the ~305px day-column budget, "there is genuinely something for
 * `scrollToTime` to scroll" — is asserted in the vitest layers only as an
 * AUTHORED CLASS or CONSTANT, because jsdom reports every box as zero (pitfall
 * P7). Those pins say the right tree renders; they say nothing about the
 * rendered box. This describe is the only place in the phase where layout is
 * real, so a geometry claim is asserted here or it is unasserted.
 */
test.describe('Phase 88.1 Req 7 / C6 — measured scheduler geometry at 375x667 (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'the 44px floor and the phone column budget are phone-tenet requirements — phone project only');

  test('the 44px touch floor holds on every strip cell and every day-column cell', async ({ page }) => {
    await openVisualScheduler(page);

    // (a) The strip. 327px of content at 375px is 46.7px per cell against the
    // 44px floor — 2.7px of margin, total. `SchedulerWeekStrip`'s container
    // comment calls a padding "tidy-up" here a regression precisely because this
    // measurement is the only thing that can see it.
    const tabs = dialog(page).getByRole('tab');
    await guardResolved(tabs, 'the phone week strip\'s day tabs', 7);
    const tabBoxes = await tabs.evaluateAll((els) =>
      els.map((el, i) => {
        const r = el.getBoundingClientRect();
        return { i, width: r.width, height: r.height };
      }),
    );
    for (const b of tabBoxes) {
      expect(
        b.width,
        `strip cell ${b.i} measures ${b.width}px wide against the 44px floor — the strip's whole budget is 2.7px, so container padding, a per-cell border or a gap larger than gap-px each breach it (T-88.1-34)`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        b.height,
        `strip cell ${b.i} measures ${b.height}px tall against the 44px floor — h-14 (56px) is the authored value`,
      ).toBeGreaterThanOrEqual(44);
    }

    // (b) The day column. WeekGrid's cells are `h-12` at phone (sm: starts at
    // 640px), and days=1 makes each one the full column width.
    const cellBoxes = await page.evaluate(() => {
      const grid = document.querySelector('[role="dialog"] [role="grid"]');
      return Array.from(grid?.querySelectorAll('[data-coord]') ?? []).map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { coord: el.getAttribute('data-coord') ?? '', width: r.width, height: r.height };
      });
    });
    expect(
      cellBoxes.length,
      'no day-column cells resolved — a zero-length measurement set makes this floor assertion vacuous',
    ).toBeGreaterThan(0);
    const tooSmall = cellBoxes.filter((c) => c.width < 44 || c.height < 44);
    expect(
      tooSmall.slice(0, 5),
      `${tooSmall.length} of ${cellBoxes.length} day-column cells measure under 44px on one axis — the interactive slot target breached the touch floor`,
    ).toEqual([]);
  });

  test('day labels render complete — nothing is clipped at 375px (the M-03 failure)', async ({ page }) => {
    await openVisualScheduler(page);

    // The strip cell is `overflow-hidden`, so a label that no longer fits is
    // clipped SILENTLY — scrollWidth vs clientWidth is what makes that visible.
    // The stacked single-letter-over-date shape (copied verbatim from
    // EventHeatmapBackground.js:216-226) is the M-03 fix; this is its gate.
    const clipping = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]');
      const measure = (el: Element, what: string) => ({
        what,
        text: (el.textContent ?? '').trim(),
        scrollWidth: (el as HTMLElement).scrollWidth,
        clientWidth: (el as HTMLElement).clientWidth,
      });
      const out: Array<ReturnType<typeof measure>> = [];
      root?.querySelectorAll('[role="tab"]').forEach((tab, i) => {
        out.push(measure(tab, `strip cell ${i}`));
        tab.querySelectorAll('span').forEach((span, j) => out.push(measure(span, `strip cell ${i} span ${j}`)));
      });
      root?.querySelectorAll('[role="columnheader"]').forEach((h, i) => out.push(measure(h, `day header ${i}`)));
      return out;
    });
    expect(
      clipping.length,
      'no strip cells or day headers resolved — the truncation check would be vacuous',
    ).toBeGreaterThan(0);
    const clipped = clipping.filter((c) => c.clientWidth > 0 && c.scrollWidth > c.clientWidth + 1);
    expect(
      clipped,
      `these labels are clipped at 375px (scrollWidth > clientWidth) — the M-03 truncation failure the stacked single-letter-over-date format exists to fix has regressed: ${JSON.stringify(clipped)}`,
    ).toEqual([]);

    // Positive half: the day column's header carries the full `dd EEE` text
    // (plan 88.1-07's uneditable Layer-3 contract), not an ellipsised fragment.
    await expect(
      dialog(page).getByRole('columnheader'),
      'the day column header is not the complete "dd EEE" string — a clipped header passes a scrollWidth check when the text itself was shortened',
    ).toHaveText(/^\d{2} (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  });

  test('the day column scrolls INTERNALLY rather than growing the modal', async ({ page }) => {
    await openVisualScheduler(page);

    // The modal stays inside its own `max-h-[90vh]` budget (Modal.tsx:186).
    const modalBox = await dialog(page).boundingBox();
    expect(modalBox, 'the create-event dialog has no boundingBox').not.toBeNull();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(
      modalBox!.height,
      `the create-event modal measures ${modalBox!.height}px tall against its max-h-[90vh] budget (${viewportHeight * 0.9}px) — the day column grew the modal instead of scrolling inside it, which re-opens DEF-88-17-01 / 88-32 ruling 6`,
    ).toBeLessThanOrEqual(viewportHeight * 0.9 + 1);

    // ...and there is GENUINELY something to scroll. This is the half jsdom
    // cannot see: it reports scrollHeight and clientHeight as 0, so plan
    // 88.1-02's pins could only assert the authored `maxBodyHeight` class.
    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");
    expect(
      geo.gridCount,
      'more than one role=grid inside the dialog — the phone fork rendered both arms, so every arm assertion in this file is measuring the wrong tree',
    ).toBe(1);
    expect(
      geo.scroller.clientHeight,
      `the day column's scroll container measures ${geo.scroller.clientHeight}px of client height — a zero (or unbounded) value means WeekGrid's maxBodyHeight seam is not applying and the internal scroll is not the thing that moves`,
    ).toBeGreaterThan(100);
    expect(
      geo.scroller.scrollHeight,
      `the day column's content (${geo.scroller.scrollHeight}px) does not exceed its client box (${geo.scroller.clientHeight}px) — the column is not scrolling internally, which makes both the edge-auto-scroll case and the scrollToTime case below vacuous`,
    ).toBeGreaterThan(geo.scroller.clientHeight + 10);
  });

  test('the opening scroll lands on the DISPLAYED day\'s peak, and follows it across the strip', async ({ page }) => {
    /* ASSERTED UNCONDITIONALLY, and that is the point (2026-08-22 adversarial
       review). This is the phase's ONLY behavioural check of the opening scroll —
       plan 88.1-01's Layer-2 pin only asserts "mounts without throwing", because
       in jsdom `offsetTop` is 0 and the effect is an inert no-op by design
       (EventScheduler.tsx says so in its own words). A skip-if-absent
       version of this case would be green forever against any fixture.

       A NULL PEAK IS A FIXTURE FAILURE, NOT A PASS: `peakScrollTime` is null
       whenever the group has no availability (createEvent.js:81-85, :109), so a
       silent skip here would mean the fixture stopped seeding and nobody found
       out. `scripts/e2e-fixtures.js` owns that invariant — see the block it
       added for this case.

       RE-POINTED BY PLAN 88.1-18 (SPEC Req 13), and the OLD SHAPE IS THE LESSON:
       this case used to prove only "the column landed on SOME row's offsetTop,
       rather than at the top", which stayed GREEN under the very defect Req 13
       fixes — landing on the WEEK's peak satisfies it just as well as landing on
       the DAY's. It now walks all seven strip days and requires the landing to
       FOLLOW THE DISPLAYED DAY: the earliest row of that day's own maximum count,
       or the top of the grid when that day has no availability at all (the owner's
       2026-08-24 ruling, chosen over a week-peak fallback). Do not weaken this
       back to "not the top".

       Plan 88.1-18 also added a vitest pin that stubs `offsetTop` to make the
       chosen ROW observable in jsdom. That stub fabricates no layout, so THIS
       remains the only measurement of the real thing. */
    await openVisualScheduler(page);

    // START_HOUR / SLOT_MINUTES / SLOT_ROWS, mirrored from EventScheduler.tsx so the expected row
    // is computed the same way the component computes it (including the clamp).
    const GRID_START_HOUR = 10;
    const GRID_SLOT_MINUTES = 30;
    const GRID_SLOT_ROWS = 28;

    const tabs = dialog(page).getByRole('tab');
    await expect(
      tabs,
      'the phone strip did not render seven day tabs — without the strip there is no way to change the DISPLAYED day, so this case could not observe Req 13 at all',
    ).toHaveCount(7);

    /**
     * Read the day column: its header, its scroll position, every row's authored offset, and the
     * per-hour availability counts the cells themselves render.
     */
    const readDay = async () =>
      page.evaluate(() => {
        const root = document.querySelector('[role="dialog"]');
        const grid = root?.querySelector('[role="grid"]') as HTMLElement | null;
        const scroller = grid?.parentElement as HTMLElement | null;
        if (!root || !grid || !scroller) return null;

        const rowOffsets: Array<{ row: number; offsetTop: number }> = [];
        const hours = new Map<number, number>();

        grid.querySelectorAll('[data-coord$=":0"]').forEach((wrapper) => {
          const row = Number((wrapper.getAttribute('data-coord') ?? '').split(':')[0]);
          if (!Number.isFinite(row)) return;
          // `offsetTop` is relative to WeekGrid's positioned body — exactly the value the landing
          // effect assigns (`container.scrollTop = cell.offsetTop`), so an exact match proves THAT
          // effect ran rather than some other scroll.
          rowOffsets.push({ row, offsetTop: (wrapper as HTMLElement).offsetTop });

          const labelled = wrapper.matches('[aria-label]')
            ? (wrapper as HTMLElement)
            : (wrapper.querySelector('[aria-label]') as HTMLElement | null);
          const matched = /^Availability for \d{4}-\d{2}-\d{2} hour (\d+)$/.exec(
            labelled?.getAttribute('aria-label') ?? '',
          );
          if (!matched) return; // an un-annotated cell carries no availability, by construction

          // The count badge is the only TEXT inside an availability cell: the tooltip is
          // portal-mounted only while open (HeatmapTooltip.js), and the selected-slot block is an
          // empty aria-hidden div. So the cell's own text IS the count.
          const count = Number((wrapper.textContent ?? '').trim());
          if (!Number.isFinite(count)) return;
          const hour = Number(matched[1]);
          hours.set(hour, Math.max(hours.get(hour) ?? 0, count));
        });

        return {
          header: root.querySelector('[role="columnheader"]')?.textContent ?? '',
          scrollTop: scroller.scrollTop,
          maxScroll: scroller.scrollHeight - scroller.clientHeight,
          rowOffsets: rowOffsets.sort((a, b) => a.row - b.row),
          hours: Array.from(hours, ([hour, count]) => ({ hour, count })).sort(
            (a, b) => a.hour - b.hour,
          ),
        };
      });

    /** Max count, earliest hour on a tie, null when nothing is available — `peakHourForDay`. */
    const expectedRowFor = (hours: Array<{ hour: number; count: number }>): number | null => {
      const populated = hours.filter((h) => h.count > 0);
      if (populated.length === 0) return null;
      const max = Math.max(...populated.map((h) => h.count));
      const peakHour = Math.min(...populated.filter((h) => h.count === max).map((h) => h.hour));
      const minutesFromStart = (peakHour - GRID_START_HOUR) * 60;
      return Math.max(
        0,
        Math.min(GRID_SLOT_ROWS - 1, Math.floor(minutesFromStart / GRID_SLOT_MINUTES)),
      );
    };

    const perDay: Array<{
      index: number;
      header: string;
      hours: Array<{ hour: number; count: number }>;
      expectedRow: number | null;
      expectedScrollTop: number | null;
      scrollTop: number;
    }> = [];

    for (let i = 0; i < 7; i += 1) {
      // The strip cell's accessible name is `${format(date,'EEEE d')}, …` (SchedulerWeekStrip),
      // so the day-of-month is readable from the tab itself — no date arithmetic in the spec.
      const tabLabel = await tabs.nth(i).getAttribute('aria-label');
      const dayOfMonth = /\s(\d{1,2}),/.exec(tabLabel ?? '')?.[1];
      expect(
        dayOfMonth,
        `strip tab ${i} has no parseable day-of-month in its accessible name ("${tabLabel}") — the tab naming changed, and without it this case cannot tell which day it is measuring`,
      ).toBeDefined();

      await tabs.nth(i).click();
      // The day column header is `dd EEE`, so this waits for the DISPLAYED day to actually change
      // before anything is measured.
      await expect(dialog(page).getByRole('columnheader')).toHaveText(
        new RegExp(`^${String(Number(dayOfMonth)).padStart(2, '0')} `),
      );

      // Settle. The landing effect runs after the commit, and nothing else writes scrollTop on a
      // same-week tap (the parent's `resolveWeekNav` skips the refetch), so two identical readings
      // mean the column has stopped moving.
      let previous = Number.NaN;
      await expect
        .poll(
          async () => {
            const now = (await readDay())?.scrollTop ?? Number.NaN;
            const stable = Object.is(now, previous);
            previous = now;
            return stable;
          },
          {
            message: `the day column's scroll position never settled after tapping strip day ${i} — something is still writing scrollTop, so no landing assertion below would be meaningful`,
            timeout: 10_000,
          },
        )
        .toBe(true);

      const reading = must(await readDay(), `the day column's landing for strip day ${i}`);
      const expectedRow = expectedRowFor(reading.hours);
      const offsetForRow =
        expectedRow === null
          ? null
          : reading.rowOffsets.find((r) => r.row === expectedRow)?.offsetTop ?? null;
      perDay.push({
        index: i,
        header: reading.header,
        hours: reading.hours,
        expectedRow,
        // The browser clamps a scrollTop beyond the scrollable extent, and so must the expectation.
        expectedScrollTop: offsetForRow === null ? null : Math.min(offsetForRow, reading.maxScroll),
        scrollTop: reading.scrollTop,
      });
    }

    /* NON-VACUITY GUARD — checked BEFORE the landing assertions on purpose, so a day-invariant
       fixture reports itself rather than surfacing as seven confusing landing failures. If every
       day peaks on the same row then "the day's peak" and "the week's peak" are the same number,
       and this whole case would pass just as well against the defect Req 13 removes. */
    const distinctRows = Array.from(
      new Set(perDay.filter((d) => d.expectedRow !== null).map((d) => d.expectedRow)),
    );
    expect(
      distinctRows.length,
      `the seeded availability is DAY-INVARIANT — all seven strip days peak on the same grid row (${JSON.stringify(distinctRows)}), which makes the day-vs-week distinction this case exists to prove unobservable. Fix the FIXTURE, never this assertion. Owners: periodictabletopbackend_v2/Sonnet/scripts/seed-sample-data.js:722-749 (Alice evenings all week, Bob weekday afternoons, Charlie weekend daytime, Diana two evenings — the shape that makes weekdays and weekends peak differently) and periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js, whose no-availability fallback block seeds peaks that VARY by weekday (Tue/Thu 19:00, Mon/Wed/Fri 13:00, Sat/Sun 18:00) — so if that block ran, it is not your cause; grep its "DECISION Phase 88.1-20 (WR-04)" marker rather than a line number, which rots. Corrected 88.1-21: this message used to describe that fallback as uniform across the week, which sent fixers at an already-correct file. Per-day readings: ${JSON.stringify(perDay)}`,
    ).toBeGreaterThanOrEqual(2);

    for (const day of perDay) {
      if (day.expectedRow === null) {
        // The owner's ruling: a day with no availability does NOT scroll, and in particular does
        // not inherit the previous day's position.
        expect(
          day.scrollTop,
          `strip day ${day.index} ("${day.header}") has NO availability, so the column must stay at the top (SPEC Req 13, owner ruling 2026-08-24) — it is at ${day.scrollTop}px instead, which is a position belonging to some other day`,
        ).toBe(0);
        continue;
      }
      expect(
        Math.abs(day.scrollTop - (day.expectedScrollTop as number)),
        `strip day ${day.index} ("${day.header}") peaks at row ${day.expectedRow}, whose offsetTop clamps to ${day.expectedScrollTop}px — the column is at ${day.scrollTop}px. The landing is not following the DISPLAYED day (SPEC Req 13). Per-hour counts read from the cells: ${JSON.stringify(day.hours)}`,
      ).toBeLessThanOrEqual(1);
    }

    // …and the case still carries its original guarantee: at least one day genuinely scrolls, so
    // "everything is 0" cannot pass as "correct".
    expect(
      perDay.some((d) => d.scrollTop > 0),
      `every strip day opened at the top — either the fixture group has no availability at all (a FIXTURE failure, owned by scripts/e2e-fixtures.js, never a pass) or the landing effect no longer resolves its row. The user opens onto roughly six of 28 rows, so landing on peak availability is what makes those six the right six. Per-day readings: ${JSON.stringify(perDay)}`,
    ).toBe(true);
  });

  test('characterizes the desktop-arm first frame (plan 88.1-12 deviation 3)', async ({ page }) => {
    /* THE ONE DEFECT PLAN 88.1-12 KNOWINGLY SHIPPED, measured here because it is
       unobservable anywhere else. `isPhoneViewport` starts FALSE and is corrected
       in a mount effect, so the phone arm's FIRST painted frame is the desktop
       one — the seven-column grid at 375px that D-03 exists to avoid.

       NOT FIXED HERE, and the obvious fix is NOT available: plan 88.1-12's
       recommendation was a lazy `useState(() => window.matchMedia(...).matches)`
       initializer, but `createEvent.js` and `EventScheduler.tsx` are both
       `'use client'`, which in the App Router STILL server-renders — the lazy
       initializer would throw on the server or become a hydration mismatch.
       Plan 88.1-11's marker fixed the initial value deliberately for exactly
       that reason. So this case CHARACTERIZES rather than gates: it records the
       trace in the CI log for plan 88.1-15's owner walkthrough, and fails only
       if the desktop arm lingers long enough to be perceptible.

       Every locator resolves too late to see this — the swap is done before the
       first `expect` settles — so the observer is installed BEFORE the modal
       mounts and samples the DOM on every mutation. */
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await page.evaluate(() => {
      const trace: ArmSample[] = [];
      window.__schedulerArmTrace = trace;
      const t0 = performance.now();
      const sample = () => {
        const root = document.querySelector('[role="dialog"]');
        if (!root) return;
        const entry: ArmSample = {
          t: Math.round(performance.now() - t0),
          headers: root.querySelectorAll('[role="columnheader"]').length,
          tabs: root.querySelectorAll('[role="tab"]').length,
          toggle: root.querySelectorAll('[role="group"][aria-label="Calendar view"]').length,
        };
        const last = trace[trace.length - 1];
        if (!last || last.headers !== entry.headers || last.tabs !== entry.tabs || last.toggle !== entry.toggle) {
          trace.push(entry);
        }
      };
      new MutationObserver(sample).observe(document.body, { childList: true, subtree: true });
      sample();
    });

    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    // Settle on the phone arm before reading the trace.
    await expect(dialog(page).getByRole('tab')).toHaveCount(7);

    const trace = (await page.evaluate(() => window.__schedulerArmTrace ?? [])) as ArmSample[];
    expect(trace.length, 'the arm-trace observer recorded nothing — the probe never saw the dialog and this characterization is vacuous').toBeGreaterThan(0);

    const desktopFrame = trace.find((s) => s.headers === 7 || s.toggle === 1);
    const phoneFrame = trace.find((s) => s.tabs === 7 && s.headers === 1);
    // eslint-disable-next-line no-console -- the recorded evidence is this case's product; plan 88.1-15's walkthrough reads it out of the CI log.
    console.log(
      `[88.1-14 FLASH PROBE] desktop-arm first frame ${desktopFrame ? 'OBSERVED' : 'not observed'}; trace=${JSON.stringify(trace)}`,
    );

    expect(
      phoneFrame,
      `the scheduler never settled on the phone arm (7 strip tabs + 1 day column). Trace: ${JSON.stringify(trace)}`,
    ).toBeTruthy();

    if (desktopFrame) {
      const lingerMs = (phoneFrame as ArmSample).t - desktopFrame.t;
      expect(
        lingerMs,
        `the desktop arm (7 day columns and the week/day toggle at 375px) stayed on screen for ${lingerMs}ms before the phone arm replaced it — that is long enough to be seen, so the flash has stopped being a sub-frame artefact and is now a visible defect. Trace: ${JSON.stringify(trace)}`,
      ).toBeLessThan(250);
    }
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

  test('a mouse drag commits ONE range, on the anchor\'s day column only', async ({ page }, testInfo) => {
    await openVisualScheduler(page);
    // The modal body scrolls independently; bring the grid's top into view before
    // measuring, or every cell rect is outside the viewport and unresolvable.
    await dialog(page).getByRole('columnheader').first().scrollIntoViewIfNeeded();
    await settleSchedulerGeometry(page);
    await resetColumnScroll(page);

    const geo = must(await gridGeometry(page), "the scheduler grid's geometry");

    // MEASUREMENT ONLY (plan 88.1-19). The desktop `endRow` failure (4 where 5 was
    // expected) is the SAME mechanism as case 3's at a different viewport — and the
    // 1280x720 numbers are what PROVE that rather than assert it. At 720px the
    // `max-h-[90vh]` modal is 648px tall and centred, so the clipped band and
    // `gridGeometry`'s viewport-clamped band diverge by a different amount than they do
    // at 667px; that difference is the point of measuring both arms.
    await attachDiagnostics(testInfo, 'desktop-pre-drag', {
      viewport: await probeViewport(page),
      geometry: await probeSchedulerGeometry(page),
      specHelperBand: {
        scroller: geo.scroller,
        visibleCount: geo.visible.length,
        cellCount: geo.cells.length,
        gridCount: geo.gridCount,
      },
    });

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
    // long-press), so this is the full range machine in one gesture. The target is
    // re-resolved LIVE on every step — the desktop arm shifted by the SAME 62px as the
    // phone arm (plan 19: `contentOffsetTopInClip` 195 -> 257) and committed `endRow` 4
    // where 5 was expected. See `mouseMovesToCell`.
    const desktopPath = await mouseMovesToCell(page, { x: anchor.cx, y: anchor.cy }, target.coord);

    // MEASUREMENT ONLY (plan 88.1-19), button still down — kept after the fix (T-88.1-64).
    // The desktop arm's pre-drag numbers alone could not name a layer: on the first
    // instrumented run (32773229213) every target cell resolved to ITSELF before the drag,
    // yet the commit still ended one row short. The mid-drag sample is what saw it — content
    // above the grid GREW 62px (`contentOffsetTopInClip` 195 -> 257 with `scrollTop` 0), so
    // the pre-computed coordinate pointed one row high. `dragPath` below is the path ACTUALLY
    // dispatched by the live chase, not a formula, so it stays comparable to `resolvesTo`.
    await attachDiagnostics(testInfo, 'desktop-mid-drag', {
      anchor: { coord: anchor.coord, row: anchor.row, col: anchor.col, cx: anchor.cx, cy: anchor.cy },
      target: { coord: target.coord, row: target.row, col: target.col, cx: target.cx, cy: target.cy },
      anchorColumn: anchorColumn.map((c) => ({ coord: c.coord, row: c.row, cy: c.cy })),
      targetColumn: targetColumn.map((c) => ({ coord: c.coord, row: c.row, cy: c.cy })),
      dragPath: await probePointPath(page, desktopPath),
      geometry: await probeSchedulerGeometry(page),
    });

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
