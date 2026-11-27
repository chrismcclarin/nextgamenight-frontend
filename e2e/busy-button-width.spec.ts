import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { openGroupSettings } from './support/groupSettings';
import {
  expectNoApiWrites,
  holdRequests,
  holdWrites,
  settleAnimations,
  type RequestHold,
  type WriteHold,
} from './support/inFlight';
import { isWriteGet } from './support/largeTextSurfaces';
import { setNarrowLargeText } from './support/wordLines';

// Phase 89.6-36, S4w = S4-c (owner pick 2026-11-23: Same width, spinner only).
//
// WHAT. A busy Button keeps its resting size while its Spinner shows: its width, height and left
// edge do not change, the Cancel beside it stays where it is, the words give way to a Spinner
// centred in the button, and the accessible name still says the label and "saving". Before this
// plan the Spinner was mounted beside the label and the button grew by the Spinner's 16px plus the
// 8px gap (24px; 48px at 320 wide with 200% text), which moved the Cancel beside it.
// Measured on Save Changes in the Customize Group dialog, at rest and while its write is held.
//
// WRITE GUARD. holdWrites is registered FIRST, before any other route and before the navigation,
// so every request that is not a GET or HEAD is held in the browser as the last resort. Then
// holdRequests takes the settings PUT, matched by pathname on any host, so the BFF proxy at
// localhost:3000/api and the backend at localhost:4000/api are both caught; it is answered in the
// browser with a 500 after the reads, so nothing is saved and the dialog stays open. The spec never
// calls unrouteAll: disabling interception resumes held requests (the 88.9-03 leak). Two more
// routes are registered before the navigation, as the two-tap spec and the sweep's write guard do:
// the signed-in self read is sent on with its timezone parameter deleted (the backend backfills a
// missing time zone from it), and every GET that writes (the WRITE_GETS list behind isWriteGet in
// e2e/support/largeTextSurfaces/index.ts: invite-token, rsvp/respond, prompt-settings) is held
// unanswered in the browser, never sent. The dialog's read-only schedule summary reads the group's
// prompt settings, one of those GETs, so it stays loading; the Save and Cancel boxes are read at
// rest and while busy in that same state, so the comparison is not affected.
//
// WHERE. Both projects (phone and journeys). Each test sets its viewport before the navigation;
// there is no conditional skip. Its two rows in scripts/gate-c-floors.manifest.mjs exist so that a
// green run names this spec (CI prints no line per passing test).
//
// CI ONLY like every signed-in spec here (C-14): the projects need the setup project's login,
// whose credentials exist only in CI. Typecheck and listing are the local proof.

// Copied from e2e/group-settings-pending-focus.spec.ts ("const SETTINGS_PATH").
const SETTINGS_PATH = /\/groups\/[^/]+\/settings$/;

const isSelfReadWithTimezone = (url: URL): boolean =>
  /\/users\/[^/]+$/.test(url.pathname) && url.searchParams.has('timezone');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const readBox = (locator: Locator): Promise<Box> =>
  locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

// The opacity of every element child of the button except the Spinner (the label span and, while
// busy, the screen-reader suffix).
const readWordOpacities = (button: Locator): Promise<string[]> =>
  button.evaluate((el) =>
    Array.from(el.children)
      .filter((child) => child.getAttribute('data-slot') !== 'spinner')
      .map((child) => getComputedStyle(child).opacity),
  );

const near = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance;

test.describe('S4w (89.6-36): a busy button keeps its width', () => {
  let hold: WriteHold | undefined;
  let putHold: RequestHold | undefined;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any route and before the navigation, so it is the last resort.
    hold = await holdWrites(page);
    // Registered after the hold, so it runs before it: the one write this spec is about.
    putHold = await holdRequests(page, { method: 'PUT', match: (url) => SETTINGS_PATH.test(url.pathname) });
    await page.route(isSelfReadWithTimezone, async (route: Route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      const url = new URL(request.url());
      url.searchParams.delete('timezone');
      await route.continue({ url: url.toString() });
    });
    await page.route(isWriteGet, async (route: Route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'HEAD') {
        await route.fallback();
        return;
      }
      // Held: never answered, never handed on.
    });
  });

  test.afterEach(async () => {
    await putHold?.abortAll();
    expectNoApiWrites(hold);
  });

  async function measureHold(page: Page, tag: string): Promise<void> {
    if (!putHold) throw new Error(`${tag}: the settings PUT hold was not registered`);
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /customize group/i }) });
    const save = dialog.getByRole('button', { name: /^Save Changes( ?, saving)?$/ });
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel, `${tag}: the dialog has one Cancel`).toHaveCount(1);
    await save.scrollIntoViewIfNeeded();
    await settleAnimations(dialog);

    const restSave = await readBox(save);
    const restCancel = await readBox(cancel);

    await save.click();
    await putHold.arrived;
    const spinner = save.locator('[data-slot="spinner"]');
    await expect(spinner, `${tag}: the Spinner shows while the write is held`).toHaveCount(1, { timeout: 5_000 });

    const busySave = await readBox(save);
    const busyCancel = await readBox(cancel);
    const spinnerBox = await readBox(spinner);
    const busyOpacities = await readWordOpacities(save);
    await expect(save, `${tag}: the busy name still says the label and saving`).toHaveAccessibleName(/^Save Changes ?, saving$/);

    const boxes = JSON.stringify({ restSave, busySave, restCancel, busyCancel, spinnerBox, busyOpacities });
    // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 89.6-36)
    console.log(`[89.6-36 S4w] ${tag} ${boxes}`);

    expect(
      near(busySave.width, restSave.width, 0.5),
      `${tag}: Save Changes changed width while busy (rest ${restSave.width}, busy ${busySave.width})`,
    ).toBe(true);
    expect(
      near(busySave.height, restSave.height, 0.5),
      `${tag}: Save Changes changed height while busy (rest ${restSave.height}, busy ${busySave.height})`,
    ).toBe(true);
    expect(
      near(busySave.x, restSave.x, 0.5),
      `${tag}: Save Changes moved sideways while busy (rest x ${restSave.x}, busy x ${busySave.x})`,
    ).toBe(true);
    expect(
      near(busyCancel.x, restCancel.x, 0.5),
      `${tag}: Cancel moved sideways while Save Changes was busy (rest x ${restCancel.x}, busy x ${busyCancel.x})`,
    ).toBe(true);
    expect(
      near(busyCancel.width, restCancel.width, 0.5),
      `${tag}: Cancel changed width while Save Changes was busy (rest ${restCancel.width}, busy ${busyCancel.width})`,
    ).toBe(true);
    const saveCentreX = busySave.x + busySave.width / 2;
    const saveCentreY = busySave.y + busySave.height / 2;
    const spinnerCentreX = spinnerBox.x + spinnerBox.width / 2;
    const spinnerCentreY = spinnerBox.y + spinnerBox.height / 2;
    expect(
      near(spinnerCentreX, saveCentreX, 1),
      `${tag}: the Spinner is not centred across the button (spinner centre x ${spinnerCentreX}, button centre x ${saveCentreX})`,
    ).toBe(true);
    expect(
      near(spinnerCentreY, saveCentreY, 1),
      `${tag}: the Spinner is not centred down the button (spinner centre y ${spinnerCentreY}, button centre y ${saveCentreY})`,
    ).toBe(true);
    expect(busyOpacities.length, `${tag}: the busy button has no word children to read`).toBeGreaterThan(0);
    expect(
      busyOpacities.every((opacity) => opacity === '0'),
      `${tag}: the words are still drawn while the Spinner shows (opacities ${busyOpacities.join(', ')}, want every one 0)`,
    ).toBe(true);

    // Answered in the browser: nothing is saved, the error toasts and the dialog stays open.
    await putHold.release({ error: 'held by e2e (89.6-36)' }, 500);
    await expect(spinner, `${tag}: the Spinner leaves after the write is answered`).toHaveCount(0, { timeout: 5_000 });
    const afterSave = await readBox(save);
    const afterOpacities = await readWordOpacities(save);
    expect(
      near(afterSave.width, restSave.width, 0.5),
      `${tag}: Save Changes did not return to its resting width (rest ${restSave.width}, after ${afterSave.width})`,
    ).toBe(true);
    expect(
      afterOpacities.every((opacity) => opacity === '1'),
      `${tag}: the words did not come back after the Spinner left (opacities ${afterOpacities.join(', ')}, want every one 1)`,
    ).toBe(true);
  }

  test('S4w (89.6-36): a busy Save Changes keeps its width and height, Cancel stays put, the spinner is centred and the name still says saving (375 x 667, normal text)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    await openGroupSettings(page);
    await measureHold(page, '375/100');
  });

  test('S4w (89.6-36): the same at 320 x 568 with 200% text', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await openGroupSettings(page);
    await setNarrowLargeText(page, 'S4w 320/200');
    await measureHold(page, '320/200');
  });
});
