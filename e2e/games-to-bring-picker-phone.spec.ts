import { test, expect } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';
import { injectViewerYesRsvp } from './support/viewerRsvp';

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
//
// DECISION Phase 88.6.2-22 (picker-entry): entry through the Bringing section's control, the
// shipped way back in, src/app/components/BringSummary.js ("const showControl = Boolean(self?.id) && Boolean(onEditClick) && ("),
// chosen over tapping RSVP Yes, because the picker auto-opens only on a CHANGE to Yes and that
// path would need a fulfilled RSVP write. The owned games and the brings are answered in the
// browser, so the row and the Add games label (no brings yet) are deterministic. Save is never
// pressed: it is a full replace of the viewer's brings. Changing this is a decision, not a
// cleanup.
//
// CI ONLY: the phone project needs the .auth storage state and the E2E login secrets, which
// exist only in CI (FE-TESTING-CONVENTIONS C-14). Locators are role, name and text only.

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

const OWNED_GAME = { id: 'e2e-bring-game-1', name: 'E2E Bring Game' };

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

    await page.addStyleTag({ content: '[role="dialog"] [role="checkbox"] { padding: 0 !important; }' }); // zz-plant-88.6.2-29 M-22a
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
});
