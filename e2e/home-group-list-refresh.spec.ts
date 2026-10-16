import { test, expect, type Route } from '@playwright/test';

import { E2E_GROUP_ID } from './support/groupSettings';

/**
 * Phase 88.6.1-41 (D-37, Req 9; Req 5 H8 save, D-07) — a Group Settings save refreshes the HOME
 * group list without blanking it, and the gear keeps focus. PHONE PROJECT ONLY (375 x 667).
 *
 * WHAT IT PROVES, in a real browser at phone width:
 * - D-37: while the list's refresh after a save is in flight, "Loading groups..." does not
 *   replace the list and the edited card stays on screen (before this plan every refresh
 *   blanked the whole list for the loader and redrew it);
 * - H8 save: the settings dialog's own close restore (plan 88.6.1-20) lands on the gear that
 *   opened it, because the list no longer unmounts that gear in the same batch as the close. A
 *   real browser blurs the Save button when it becomes natively disabled while saving, which
 *   jsdom never does, so this is the proof jsdom cannot give (grouplist.focus.test.tsx F6 is
 *   the unit half). The gear still has focus after the refresh lands.
 *
 * IT NEVER WRITES THE FIXTURE. The settings PUT is fulfilled IN THE BROWSER with a minimal body
 * and never leaves it; the groups GETs are only delayed, then continued unchanged. It never
 * types, never deletes, never confirms anything, and never presses Escape on a dirty form.
 *
 * WHAT IT CANNOT SEE: a server-side reorder (#46). The PUT never reaches the backend, so the
 * server's row order never changes and the edited card never moves. The reorder case (a card
 * the refresh only moves keeps its focused control) is pinned only by the unit arm F8 in
 * src/app/components/grouplist.focus.test.tsx.
 *
 * SELECTORS: role, label and text, plus the one contract attribute `data-testid="group-card"`
 * (DECISION Phase 88.6-47 in grouplist.js: it exists so tests address the CARD). The gear is
 * matched by the name prefix /^Customize\b/ so plan 88.6.1-54's rename (D-19) does not break it.
 *
 * CI-RUN ONLY: the phone project needs the `.auth/user.json` login state, which exists only in
 * CI (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
 */

// The browser calls the same-origin BFF, so the reads are `/api/groups/user/<uuid>` (the home
// list's own refresh AND the home page's parallel getGroupList) and the save is
// `PUT /api/groups/<id>/settings`.
const isGroupsListRead = (url: URL) => url.pathname.includes('/groups/user/');
const isSettingsWrite = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/settings`);

test.describe('Phase 88.6.1-41 — the home group list refreshes in place (phone project)', () => {
  // Same phone-only guard idiom as group-settings-danger.spec.ts: both projects match every
  // spec, and this is a phone-tenet proof measured at 375px.
  test.skip(({ isMobile }) => !isMobile, 'D-37 / H8 phone proof — phone project only');

  test('a settings save refreshes the home group list without blanking it, and the gear keeps focus (88.6.1-41)', async ({
    page,
  }) => {
    await page.goto('/');

    // The seeded owner's group (Weekend Warriors, the group the fixture emits as E2E_GROUP_ID).
    const card = page
      .getByTestId('group-card')
      .filter({ has: page.getByText('Weekend Warriors', { exact: true }) });
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Vacuity guards: exactly one card and one gear, or every later assertion is about nothing.
    await expect(card).toHaveCount(1);
    const gear = card.getByRole('button', { name: /^Customize\b/ });
    await expect(gear).toHaveCount(1);

    // Installed only now, so the first load is never held.
    await page.route(isSettingsWrite, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      // Fulfilled in the browser: the save reads only `color_preset` from the response.
      await route.fulfill({ status: 200, json: { id: E2E_GROUP_ID, color_preset: null } });
    });
    const held: Route[] = [];
    let released = false;
    await page.route(isGroupsListRead, async (route) => {
      if (released) {
        await route.continue();
        return;
      }
      held.push(route);
    });
    const listReadStarted = page.waitForRequest((request) =>
      isGroupsListRead(new URL(request.url())),
    );

    await gear.focus();
    await gear.press('Enter');
    const settingsHeading = page.getByRole('heading', { name: 'Customize Group' });
    await expect(settingsHeading).toBeVisible();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // POSITIVE signal: the refresh after the save has started (and is held).
    await listReadStarted;
    await expect(settingsHeading).toHaveCount(0);
    // While the refresh is in flight: no loader in the list's place, the edited card still shown.
    expect(await page.getByText('Loading groups...').count()).toBe(0);
    await expect(card).toBeVisible();
    // The dialog's close restore found the gear still connected.
    await expect(gear).toBeFocused();

    // Release every held read; the gear keeps focus once the refresh lands.
    const listReadAnswered = page.waitForResponse((response) =>
      isGroupsListRead(new URL(response.url())),
    );
    released = true;
    for (const route of held.splice(0)) {
      await route.continue();
    }
    await listReadAnswered;
    await expect(gear).toBeFocused();
  });
});
