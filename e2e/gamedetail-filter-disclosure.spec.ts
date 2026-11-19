import { test, expect, type Locator } from '@playwright/test';
import { E2E_GAME_PATH, routeFakeGameSuccess } from './support/fakeGame';
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

// Plan 88.9-36 G2a (owner pick G2a, 88.9-PICKS-B6.json item G2, register W54) — the game page's
// Show Filters & Sort disclosure, measured as computed style in a real browser (DEC-24). jsdom
// applies no media query and no cascade, so the class pins in src/app/gameDetail/page.test.tsx and
// src/app/cascadeOrder.test.ts cannot see whether the shape actually paints.
//
// WHAT THIS MEASURES. Phone (375): closed, the toggle keeps both 8px bottom corners; open, the
// toggle's bottom corners are 0px, the panel has no top border, and the toggle's bottom edge meets
// the panel's top edge (within 0.5px) — the toggle reads as the panel's header. Journeys (1280):
// open, the toggle keeps its 8px bottom corners and the panel keeps its 1px top border — the
// shipped detached shape from 640px up.
//
// DECISION Phase 88.9-36 G2a-e2e: dark only, chosen OVER a light pass, because corner radius and
// border width are theme-independent (no colour is asserted here). Pixel values asserted, chosen
// OVER the property-only shape of e2e/tailwind-v4-styles.spec.ts ("never a pixel value"), because
// 0px / 8px / 1px ARE the picked shape, not tunable spacing. One test branched on the project name,
// chosen OVER a skip, because both widths are the behaviour; a project with no arm throws, so a new
// project must decide its expected shape instead of passing silently. Changing this is a decision,
// not a cleanup.
//
// The game view is reached through the shared fake custom game (no game fixture exists in CI); the
// group's events and roster are real. Writes are held in the browser (holdWrites, registered before
// the fake-game routes and before navigation) and the afterEach fails the test if an /api write
// reached the hold. Nothing is screenshotted; failure messages name the property, the project and
// the read value only.

const PANEL_ID = 'game-sessions-filters';

let hold: WriteHold | undefined;

test.beforeEach(async ({ page }) => {
  hold = await holdWrites(page);
  await routeFakeGameSuccess(page);
  await page.goto(E2E_GAME_PATH);
  // D-11 (Phase 87.7): the stored theme can differ from the project colorScheme; pin dark first.
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test.afterEach(async ({ page }) => {
  expectNoApiWrites(hold);
  hold = undefined;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function bottomRadii(locator: Locator): Promise<{ left: string; right: string }> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { left: style.borderBottomLeftRadius, right: style.borderBottomRightRadius };
  });
}

test('G2a (88.9): the open filter disclosure fuses on a phone and stays detached from 640', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  if (project !== 'phone' && project !== 'journeys') {
    throw new Error(`G2a: project ${project} has no arm here; decide its expected shape before running it`);
  }

  const main = page.getByRole('main');
  const toggle = main.getByRole('button', { name: 'Show Filters & Sort', exact: true });
  await expect(toggle, `G2a (${project}): the Show Filters & Sort toggle never rendered`).toBeVisible({ timeout: 15_000 });
  const closed = await bottomRadii(toggle);

  await toggle.click();
  const open = main.getByRole('button', { name: 'Hide Filters', exact: true });
  await expect(open, `G2a (${project}): the toggle did not open`).toHaveAttribute('aria-expanded', 'true');
  const panelId = await open.getAttribute('aria-controls');
  expect(panelId, `G2a (${project}): aria-controls on the open toggle`).toBe(PANEL_ID);
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel, `G2a (${project}): the filter panel is not visible`).toBeVisible();

  const opened = await bottomRadii(open);
  const panelTop = await panel.evaluate((el) => getComputedStyle(el).borderTopWidth);

  if (project === 'phone') {
    expect(closed.left, `G2a (phone): closed toggle border-bottom-left-radius read ${closed.left}`).toBe('8px');
    expect(closed.right, `G2a (phone): closed toggle border-bottom-right-radius read ${closed.right}`).toBe('8px');
    expect(opened.left, `G2a (phone): open toggle border-bottom-left-radius read ${opened.left}`).toBe('0px');
    expect(opened.right, `G2a (phone): open toggle border-bottom-right-radius read ${opened.right}`).toBe('0px');
    expect(panelTop, `G2a (phone): panel border-top-width read ${panelTop}`).toBe('0px');
    const toggleBox = await open.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(toggleBox, 'G2a (phone): the open toggle has no layout box').not.toBeNull();
    expect(panelBox, 'G2a (phone): the panel has no layout box').not.toBeNull();
    const seam = toggleBox!.y + toggleBox!.height - panelBox!.y;
    expect(Math.abs(seam), `G2a (phone): toggle bottom to panel top read ${seam}px`).toBeLessThanOrEqual(0.5);
  } else {
    expect(opened.left, `G2a (journeys): open toggle border-bottom-left-radius read ${opened.left}`).toBe('8px');
    expect(opened.right, `G2a (journeys): open toggle border-bottom-right-radius read ${opened.right}`).toBe('8px');
    expect(panelTop, `G2a (journeys): panel border-top-width read ${panelTop}`).toBe('1px');
  }
});
