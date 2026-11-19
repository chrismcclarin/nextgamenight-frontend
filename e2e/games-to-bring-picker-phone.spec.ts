import { test, expect } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';
import { injectViewerYesRsvp } from './support/viewerRsvp';
import { expectHeldInside, expectWholeWords, readWordLines, setNarrowLargeText, TWO_WORD_NAME } from './support/wordLines';

// Phase 88.6.2-22 (R8, register row 78: Games to Bring has no phone e2e) — the Games to Bring
// picker at 375px, in a real browser (the phone project).
//
// WHAT IT PROVES: a viewer answered Yes on load reaches the picker through the Bringing
// section's Add games control; the dialog named Games to Bring opens fully inside the 375x667
// viewport with no sideways scroll; a game row (role checkbox) clears 44 x 44 inside the viewport;
// a tap checks it; Skip for now closes the dialog.
//
// IT NEVER WRITES TO THE BACKEND. The shared write hold (holdWrites in e2e/support/inFlight.ts)
// is registered FIRST, so it runs LAST: every write is held in the browser and never sent, and
// the afterEach fails the test naming any /api write it caught. The owned-games and brings reads
// are answered in the browser by that hold; the viewer's RSVP is injected into two passed-through
// reads (injectViewerYesRsvp in e2e/support/viewerRsvp.ts). Save is never pressed.
// AMENDED Phase 88.9-69 (X62): one test presses Save, its PUT answered 500 in the browser; nothing is sent.
//
// DECISION Phase 88.6.2-22 (picker-entry): entry through the Bringing section's control, the
// shipped way back in, src/app/components/BringSummary.js ("const showControl = Boolean(self?.id) && Boolean(onEditClick) && ("),
// chosen over tapping RSVP Yes, because the picker auto-opens only on a CHANGE to Yes and that
// path would need a fulfilled RSVP write. The owned games and the brings are answered in the
// browser, so the row and the Add games label (no brings yet) are deterministic. Save is never
// pressed: it is a full replace of the viewer's brings. Changing this is a decision, not a
// cleanup.
// AMENDED Phase 88.9-69 (X62): one test presses Save, its PUT answered 500 in the browser; nothing is sent.
// The reason above stands: the full replace never reaches the backend, because the test's own
// route answers the PUT before the write hold sees it, and the afterEach still fails the test on
// any other write.
//
// CI ONLY: the phone project needs the .auth storage state and the E2E login secrets, which
// exist only in CI (FE-TESTING-CONVENTIONS C-14). Locators are role, name and text only.

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

const OWNED_GAME = { id: 'e2e-bring-game-1', name: 'E2E Bring Game' };

// The register sentence a 500 resolves to (src/components/ui/useFetchErrorState.ts, the internal
// row of its message table). A fixed string, never a fixture value.
const SAVE_FAILED_LINE = 'Something went wrong on our end. Please try again shortly.';

// CI serves the backend on another origin than the app, so an answer made up in the browser needs
// an allow-origin header or the browser blocks it and the page reads a network failure instead.
const CORS_HEADERS = { 'access-control-allow-origin': '*' };

function answerGet(url: URL): unknown {
  if (url.pathname.startsWith('/api/user-games/user/')) return [OWNED_GAME];
  if (url.pathname.startsWith('/api/event-brings/event/')) return [];
  return undefined;
}

test.describe('Games to Bring at 375px (88.6.2-22)', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    '88.6.2-22: the Games to Bring picker is a phone surface (SPEC constraint, phone-first), so this spec runs only in the phone project',
  );

  let hold: WriteHold;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any other route and before navigation, so it is the last resort.
    hold = await holdWrites(page, { answerGet });
  });

  test.afterEach(() => expectNoApiWrites(hold));

  test('the Bringing control opens Games to Bring; the dialog fits the phone viewport and a game row clears 44x44', async ({
    page,
  }) => {
    await injectViewerYesRsvp(page);
    await page.goto(E2E_EVENT_DETAIL_PATH);

    const heading = page.getByRole('heading', { name: 'Bringing', exact: true });
    await expect(
      heading,
      'the Bringing section never rendered — it renders only after its brings read succeeds, and that read is answered [] in the browser (answerGet); a miss means the brings answer did not land',
    ).toBeVisible({ timeout: 15_000 });

    const control = heading.locator('xpath=..').getByRole('button', { name: 'Add games', exact: true });
    await expect(
      control,
      'no Add games control in the Bringing section — it shows only for a viewer whose RSVP reads yes (the injected yes row) with no brings (the empty brings answer); a miss means one of those two did not land',
    ).toBeVisible();

    await control.tap();

    const dialog = page.getByRole('dialog', { name: 'Games to Bring', exact: true });
    await expect(dialog, 'the Add games control did not open the Games to Bring dialog').toBeVisible({
      timeout: 10_000,
    });
    const row = dialog.getByRole('checkbox', { name: 'E2E Bring Game', exact: true });
    await expect(
      row,
      'the owned game row never rendered — the owned-games read is answered with one game in the browser (answerGet)',
    ).toBeVisible({ timeout: 10_000 });

    await settleAnimations(dialog);
    await expectTouchTarget(row, 'the Games to Bring row', {
      withinViewportOf: page,
      why: 'the row height comes from p-2 around the 32px thumbnail well, not a min-h floor',
    });

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'the Games to Bring dialog has no bounding box').not.toBeNull();
    expect(viewport, 'the page has no viewport size').not.toBeNull();
    if (!box || !viewport) return;
    const where = `dialog x ${box.x}px y ${box.y}px, ${box.width}px wide x ${box.height}px tall; viewport ${viewport.width} x ${viewport.height}px`;
    expect(box.x, `the dialog's left edge is outside the viewport (${where})`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `the dialog's right edge is outside the viewport (${where})`).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(box.y, `the dialog's top edge is above the viewport (${where})`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `the dialog's bottom edge is below the viewport (${where})`).toBeLessThanOrEqual(
      viewport.height,
    );

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `the page scrolls sideways with Games to Bring open (scrollWidth ${overflow.scrollWidth}px, clientWidth ${overflow.clientWidth}px)`,
    ).toBeLessThanOrEqual(overflow.clientWidth);

    await row.tap();
    await expect(row, 'a tap on the game row did not check it').toHaveAttribute('aria-checked', 'true');

    await dialog.getByRole('button', { name: 'Skip for now', exact: true }).tap();
    await expect(dialog, 'Skip for now did not close the Games to Bring dialog').toHaveCount(0);
  });

  test('X62 (88.9-69): after a failed save the line sits midway between the last game row and the footer rule at 375', async ({
    page,
  }) => {
    // Owner row 52-X62: "There's a gap between the games list and the warning and the warning is
    // sitting too close to the line." Registered AFTER the write hold, so it runs BEFORE it: the
    // brings PUT is answered 500 here, in the browser, the moment it arrives. It is never held and
    // never sent, so nothing is left to resume when the routes are removed.
    let puts = 0;
    await page.route(
      (url) => url.pathname.endsWith('/my-brings'),
      async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.fallback();
          return;
        }
        puts += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'synthetic (88.9-69 e2e)' }),
        });
      },
    );

    await injectViewerYesRsvp(page);
    await page.goto(E2E_EVENT_DETAIL_PATH);

    const heading = page.getByRole('heading', { name: 'Bringing', exact: true });
    await expect(heading, 'the Bringing section never rendered').toBeVisible({ timeout: 15_000 });
    const control = heading.locator('xpath=..').getByRole('button', { name: 'Add games', exact: true });
    await expect(control, 'no Add games control in the Bringing section').toBeVisible();
    await control.tap();

    const dialog = page.getByRole('dialog', { name: 'Games to Bring', exact: true });
    await expect(dialog, 'the Add games control did not open the Games to Bring dialog').toBeVisible({
      timeout: 10_000,
    });
    const row = dialog.getByRole('checkbox', { name: 'E2E Bring Game', exact: true });
    await expect(row, 'the owned game row never rendered').toBeVisible({ timeout: 10_000 });
    await row.tap();
    await expect(row, 'a tap on the game row did not check it').toHaveAttribute('aria-checked', 'true');

    await dialog.getByRole('button', { name: 'Save', exact: true }).tap();

    // The visible line: the dialog's paragraph with the register sentence (the announcement lives
    // in a visually hidden region, which this lookup leaves out).
    const line = dialog.locator('p:not(.sr-only)').filter({ hasText: SAVE_FAILED_LINE });
    await expect(line, 'the failed save painted no visible line in the dialog').toHaveCount(1, {
      timeout: 10_000,
    });
    expect(puts, 'the save PUT never reached the route that answers it').toBeGreaterThanOrEqual(1);

    await settleAnimations(dialog);

    // Every box in ONE evaluate. The line's CONTENT box (its box minus its own padding) against
    // the bottom of the last game row and the top edge of the footer, whose top border is the rule.
    const read = await line.evaluate((p) => {
      const dialogRoot = p.closest('[role="dialog"]');
      const rows = Array.from(dialogRoot?.querySelectorAll('[role="checkbox"]') ?? []);
      const lastRow = rows[rows.length - 1];
      const footer = p.nextElementSibling;
      const style = getComputedStyle(p);
      const box = p.getBoundingClientRect();
      const contentTop = box.top + parseFloat(style.paddingTop);
      const contentBottom = box.bottom - parseFloat(style.paddingBottom);
      return {
        hasRow: Boolean(lastRow),
        hasFooter: Boolean(footer),
        footerRule: footer ? parseFloat(getComputedStyle(footer).borderTopWidth) : 0,
        under: lastRow ? contentTop - lastRow.getBoundingClientRect().bottom : null,
        over: footer ? footer.getBoundingClientRect().top - contentBottom : null,
      };
    });

    expect(read.hasRow, 'the dialog holds no game row to measure from').toBe(true);
    expect(read.hasFooter, 'nothing follows the failed-save line, so there is no footer to measure to').toBe(true);
    expect(read.footerRule, 'the element after the line carries no top rule').toBeGreaterThan(0);
    const where = `line content box ${read.under}px under the last game row and ${read.over}px over the footer rule`;
    expect(Math.abs((read.under ?? 0) - 12), `the line is not 12px under the last game row (${where})`).toBeLessThanOrEqual(1);
    expect(Math.abs((read.over ?? 0) - 12), `the line is not 12px over the footer rule (${where})`).toBeLessThanOrEqual(1);

    await dialog.getByRole('button', { name: 'Skip for now', exact: true }).tap();
    await expect(dialog, 'Skip for now did not close the Games to Bring dialog').toHaveCount(0);
  });

  // 88.9-52 R4 D2 (owner 2026-11-18: wrap, no line limit, and the name keeps its room; his worry: a
  // long name broken up too much to read, We/eke/nd W/arr/iors). A picker row cut its game name to
  // one line between the thumbnail and the tick box; it now wraps by whole words and the two move
  // (src/app/components/BringGamePicker.js ("AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the game name wraps")).
  // The owned-games read is answered in the browser with one two-word game (registered after the
  // write hold, so it answers first); nothing is written and Save is never pressed. At 375 with
  // ordinary text the thumbnail, the name and the tick box share one line. At 320 wide with the
  // root text at 200% each word of the name is on one line (or, for a word wider than the whole
  // row, broken only after the name has the row's full width), the row holds its thumbnail and
  // tick box whole, the row is at least 44px and inside the dialog, and the dialog does not scroll
  // sideways. The page behind the dialog is not this test's subject; its sideways scroll is logged.
  test('R4 D2 (88.9-52): at 320 wide with 200% text a picker row keeps each word of a two-word game name whole, with its thumbnail and tick box whole', async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname.startsWith('/api/user-games/user/'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: JSON.stringify([{ id: 'e2e-bring-game-d2', name: TWO_WORD_NAME }]),
        });
      },
    );
    await injectViewerYesRsvp(page);
    await page.goto(E2E_EVENT_DETAIL_PATH);

    const heading = page.getByRole('heading', { name: 'Bringing', exact: true });
    await expect(heading, 'the Bringing section never rendered').toBeVisible({ timeout: 15_000 });
    const control = heading.locator('xpath=..').getByRole('button', { name: 'Add games', exact: true });
    await expect(control, 'no Add games control in the Bringing section').toBeVisible();
    await control.tap();

    const dialog = page.getByRole('dialog', { name: 'Games to Bring', exact: true });
    await expect(dialog, 'the Add games control did not open the Games to Bring dialog').toBeVisible({
      timeout: 10_000,
    });
    const row = dialog.getByRole('checkbox', { name: TWO_WORD_NAME, exact: true });
    await expect(row, 'the two-word game row never rendered (the routed owned-games answer did not land)').toBeVisible({ timeout: 10_000 });
    await settleAnimations(dialog);
    const name = row.locator('p', { hasText: TWO_WORD_NAME });

    // The row's three parts: the thumbnail well (first child), the name column, the tick box (last).
    const parts = () =>
      row.evaluate((el) => {
        const box = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const dialogEl = el.closest('[role="dialog"]') as HTMLElement;
        return {
          row: box(el),
          well: box(el.firstElementChild as Element),
          tick: box(el.lastElementChild as Element),
          rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
          dialog: box(dialogEl),
          dialogSideways: dialogEl.scrollWidth - dialogEl.clientWidth,
        };
      });

    // Ordinary text at 375: one line, as before.
    const before = await parts();
    const beforeLine = JSON.stringify(before);
    expectWholeWords(await readWordLines(name, row), ['Weekend', 'Warriors'], 'R4 D2 picker row at ordinary text', { pageSideways: false });
    expect(
      before.tick.top < before.well.bottom && before.tick.bottom > before.well.top && before.tick.left > before.well.right,
      `R4 D2: at ordinary text the tick box no longer shares the thumbnail's line (${beforeLine})`,
    ).toBe(true);

    await setNarrowLargeText(page, 'R4 D2 picker row');
    // The row is named: a word may break only once the name has the row's whole width to itself.
    const read = await readWordLines(name, row);
    const after = await parts();
    const afterLine = JSON.stringify(after);
    // eslint-disable-next-line no-console -- the measured row is recorded from the CI log
    console.log(`[88.9-52 R4 D2 picker row] 320 / 200%: ${JSON.stringify(read)} ${afterLine}`);
    expectWholeWords(read, ['Weekend', 'Warriors'], 'R4 D2 picker row at 320 / 200%', { pageSideways: false });
    await expectHeldInside(row, 'R4 D2 picker row');
    // The neighbours kept their sizes (2rem thumbnail, 1.25rem tick box): they moved, they did not shrink.
    expect(Math.abs(after.well.width - 2 * after.rem), `R4 D2: the thumbnail well is not 2rem wide (${afterLine})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.well.height - 2 * after.rem), `R4 D2: the thumbnail well is not 2rem tall (${afterLine})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.tick.width - 1.25 * after.rem), `R4 D2: the tick box is not 1.25rem wide (${afterLine})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.tick.height - 1.25 * after.rem), `R4 D2: the tick box is not 1.25rem tall (${afterLine})`).toBeLessThanOrEqual(0.5);
    // The row is the control: at least 44px, inside the dialog, and the dialog does not scroll sideways.
    expect(after.row.height, `R4 D2: the row is shorter than 44px (${afterLine})`).toBeGreaterThanOrEqual(44);
    expect(after.row.width, `R4 D2: the row is narrower than 44px (${afterLine})`).toBeGreaterThanOrEqual(44);
    expect(after.row.left, `R4 D2: the row starts left of the dialog (${afterLine})`).toBeGreaterThanOrEqual(after.dialog.left - 0.5);
    expect(after.row.right, `R4 D2: the row ends right of the dialog (${afterLine})`).toBeLessThanOrEqual(after.dialog.right + 0.5);
    expect(after.dialogSideways, `R4 D2: the dialog scrolls sideways (${afterLine})`).toBeLessThanOrEqual(0);
  });
});
