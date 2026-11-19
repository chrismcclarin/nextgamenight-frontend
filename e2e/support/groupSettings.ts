import { expect, type Page } from '@playwright/test';

// The group-settings entry path: the one way every spec opens the Customize Group modal on the
// seeded group. Moved here from the danger spec by Phase 88.6.1-20 so a second spec reuses it
// instead of copying it.

// Seeded group minted by the backend's scripts/e2e-fixtures.js in CI — same env fallback
// convention as e2e/tailwind-v4-styles.spec.ts ("const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';").
// Param is `id`, not `groupId` (src/app/groupHomePage/page.js ("const Router = searchParams.get('id');")).
export const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

/** The group-settings entry: navigates to the seeded group home, then opens Customize Group
 *  through the header gear (openGroupSettingsFromGear, below). Callers that need a non-default
 *  theme must set it BEFORE calling this — `forceLightMode` is an `addInitScript`, so it has
 *  to be registered before the `goto` below or it never runs. */
export async function openGroupSettings(page: Page): Promise<void> {
  // Group home hosts the settings entry point (param is `id`, not `groupId`).
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

  await openGroupSettingsFromGear(page);
}

/** The gear entry path, shared by both describes in the danger spec.
 *
 *  Extracted Phase 88.3.1 (plan 10) from the Danger Zone `beforeEach`, unchanged in
 *  behaviour: the swatch block reaches the SAME modal by the SAME path, and a second
 *  copy of these lines would be two things to keep in step with the page instead of one.
 *
 *  Moved Phase 88.6.1-20 from `group-settings-danger.spec.ts` to this module so a second
 *  spec (`dialog-focus-floor.spec.ts`) could reuse it.
 *
 *  Split from openGroupSettings by Phase 88.6.2-22: it never navigates, so the page's query
 *  cache survives a close and reopen of Customize Group.
 *
 *  Re-pointed Phase 88.9-31 (owner pick F5b): the one-item kebab became the header gear, so the
 *  menu step is gone. Until then this helper opened the former one-item kebab, read its
 *  aria-controls list (Plan 88.6-16 D-12 dropped the ARIA menu pattern) and pressed its one
 *  item; the gear opens the modal directly. */
export async function openGroupSettingsFromGear(page: Page): Promise<void> {
  // Title-row gear (src/app/groupHomePage/page.js ("onClick={() => setShowGroupSettings(true)}")):
  // owners and admins only, so the CI login identity, which owns the seeded group, sees it.
  const gear = page.getByRole('button', { name: 'Group settings', exact: true });
  await expect(gear).toBeVisible({ timeout: 15_000 });
  await gear.click();

  // The Customize Group modal is mounted.
  await expect(page.getByRole('heading', { name: /customize group/i })).toBeVisible();
}
