import { test, expect, type APIResponse, type Route } from '@playwright/test';

/**
 * Phase 88.6.1-42 (D-09a, Req 9; Req 5 H1, D-05 as amended by D-57) — Manage Members at 375px.
 * PHONE PROJECT ONLY (iPhone SE, 375 x 667).
 *
 * WHAT IT PROVES, in a real browser at phone width:
 * - D-09a: while the refresh after a phone remove is in flight, the roster stays painted and
 *   "Loading members..." never replaces it (before this plan every refresh blanked the roster);
 * - Req 5 H1: when that refresh removes the row whose member-actions button holds focus, focus
 *   lands on the NEXT row's member-actions button. At 375px the row's desktop controls are
 *   hidden, which jsdom (no CSS) cannot show; the unit half is F1 in
 *   src/app/components/ManageMembers.mutations.test.tsx;
 * - Req 9 / SPEC Prohibition 2: a failed FIRST load shows the members banner, never the empty
 *   roster sentence, and fits the phone.
 * The failed-REFRESH phone proof (the RF1 notice above kept rows) is plan 88.6.1-78's, added to
 * this spec.
 *
 * IT NEVER WRITES THE FIXTURE. The seeded group is shared by other specs, so the removed member
 * is SYNTHETIC: it exists only in members responses augmented in the browser, and the DELETE for
 * it is fulfilled in the browser and counted. Every other method on these paths falls back.
 *
 * SELECTORS: role, label and text only; every roster locator is scoped to the dialog, because
 * the group page's own member stack also receives the synthetic members.
 *
 * CI-RUN ONLY: the phone project needs the `.auth/user.json` login state, which exists only in
 * CI (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
 */

/* The seeded group minted by the backend's scripts/e2e-fixtures.js in CI. No '1' fallback (the
   event-scheduler-touch.spec.ts idiom): a fallback id would route a group the fixtures do not
   own, and every assertion here would prove nothing. The beforeEach turns an unset var into one
   loud failure. */
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this spec routes a group the fixtures do not own.',
  ).toBeTruthy();
});

// Non-owner `member` rows that are not the viewer, so each renders its phone member-actions
// button (named from the username). Distinct ids, so the two rows key apart.
const SYNTH = {
  id: '00000000-0000-4000-8000-0000000000d1',
  user_id: 'auth0|e2e-synthetic-removable',
  username: 'E2E Removable',
  email: null,
  UserGroup: { role: 'member' },
};
const SYNTH_NEXT = {
  id: '00000000-0000-4000-8000-0000000000d2',
  user_id: 'auth0|e2e-synthetic-neighbour',
  username: 'E2E Neighbour',
  email: null,
  UserGroup: { role: 'member' },
};

// The browser calls the same-origin BFF: the members read is `GET /api/groups/<id>/users` and
// the remove is `DELETE /api/groups/<id>/users/<member id>` (src/lib/api.ts, getGroupMembers and
// removeUserFromGroup).
const isMembersRead = (url: URL) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`);
const isSynthRemove = (url: URL) =>
  url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users/${SYNTH.id}`);

/** The real roster from the backend, as an array (an empty one if the read was not a roster). */
async function realRoster(route: Route): Promise<{ response: APIResponse; body: unknown[] }> {
  const response = await route.fetch();
  const json: unknown = await response.json();
  return { response, body: Array.isArray(json) ? json : [] };
}

test.describe('Phase 88.6.1-42 — Manage Members refreshes in place (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'D-09a / Req 5 H1 phone proof — phone project only');

  test("a phone remove keeps the roster painted while it refreshes, then focus lands on the next member's actions button", async ({
    page,
  }) => {
    let removed = false;
    let deletes = 0;
    let postRemovalHeld = false;
    let releasePostRemoval!: () => void;
    const postRemovalGate = new Promise<void>((resolve) => {
      releasePostRemoval = resolve;
    });
    let markPostRemovalArrived!: () => void;
    const postRemovalArrived = new Promise<void>((resolve) => {
      markPostRemovalArrived = resolve;
    });

    await page.route(isSynthRemove, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      deletes += 1;
      removed = true;
      await route.fulfill({ status: 200, json: {} });
    });
    await page.route(isMembersRead, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const { response, body } = await realRoster(route);
      if (!removed) {
        // SYNTH_NEXT sits directly AFTER SYNTH, so the removed row's next neighbour never
        // depends on what the seeded group holds.
        await route.fulfill({ response, json: [...body, SYNTH, SYNTH_NEXT] });
        return;
      }
      if (!postRemovalHeld) {
        // The FIRST read after the removal is the dialog's own refresh: hold it.
        postRemovalHeld = true;
        markPostRemovalArrived();
        await postRemovalGate;
      }
      await route.fulfill({ response, json: [...body, SYNTH_NEXT] });
    });

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage).toBeVisible({ timeout: 15_000 });
    await manage.tap();

    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    const trigger = dialog.getByRole('button', { name: 'Member actions for E2E Removable' });
    const next = dialog.getByRole('button', { name: 'Member actions for E2E Neighbour' });
    await expect(next, 'the fixed neighbour row renders its member-actions button').toBeVisible();

    await trigger.tap();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).tap();
    await dialog.getByRole('button', { name: 'Tap again to remove' }).tap();

    // POSITIVE signal: the refresh after the removal reached the route and is held.
    await postRemovalArrived;
    expect(deletes, 'the remove sent exactly one DELETE, fulfilled in the browser').toBe(1);
    await expect(dialog.getByText('(You)', { exact: true })).toBeVisible();
    await expect(dialog.getByText('E2E Removable', { exact: true })).toBeVisible();
    expect(
      await dialog.getByText('Loading members...').count(),
      'the refresh never puts the first-load line in the roster place',
    ).toBe(0);
    // Focus has not moved early: KebabMenu put it back on its own trigger.
    await expect(trigger).toBeFocused();

    releasePostRemoval();
    await expect(next, "focus lands on the next member's actions button").toBeFocused();
    await expect(dialog.getByText('E2E Removable', { exact: true })).toHaveCount(0);
    expect(deletes, 'still exactly one DELETE').toBe(1);
  });

  test('a failed first load shows the members banner, never an empty roster, at 375px', async ({
    page,
  }) => {
    // The group page loads its own members once identity resolves; wait for that read so the
    // failure below is served to the dialog's first load and to nothing else.
    const pageMembersRead = page.waitForResponse(
      (response) =>
        isMembersRead(new URL(response.url())) && response.request().method() === 'GET',
    );
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await pageMembersRead;
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage).toBeVisible({ timeout: 15_000 });

    let failures = 0;
    await page.route(isMembersRead, async (route) => {
      if (route.request().method() !== 'GET' || failures > 0) {
        await route.fallback();
        return;
      }
      failures += 1;
      await route.fulfill({ status: 500, json: { error: 'e2e synthetic failure' } });
    });
    await manage.tap();

    // With no roster loaded the caller has no role yet, so the title is the plain one.
    const dialog = page.getByRole('dialog', { name: 'Members', exact: true });
    await expect(dialog.getByText("Couldn't load members")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('No members found.')).toHaveCount(0);
    await expect(dialog.getByText('Loading members...')).toHaveCount(0);
    expect(failures, 'the failure was served exactly once').toBe(1);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits, 'the failed first load causes no horizontal page scroll').toBe(true);
  });
});
