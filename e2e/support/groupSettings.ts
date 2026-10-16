import { expect, type Page } from '@playwright/test';

// The group-settings entry path, shared by every spec that opens the Customize Group modal on
// the seeded group (`group-settings-danger.spec.ts`, `dialog-focus-floor.spec.ts`). Moved here
// from the danger spec by Phase 88.6.1-20 so a second spec reuses it instead of copying it.

// Seeded group minted by the backend's scripts/e2e-fixtures.js in CI — same env
// fallback convention as e2e/tailwind-v4-styles.spec.ts:49. Param is `id`, not
// `groupId` (tailwind-v4-styles.spec.ts:64-65).
export const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

/** The kebab entry path, shared by both describes in this file.
 *
 *  Extracted Phase 88.3.1 (plan 10) from the Danger Zone `beforeEach`, unchanged in
 *  behaviour: the swatch block reaches the SAME modal by the SAME path, and a second
 *  copy of these six lines would be two things to keep in step with `KebabMenu.js`
 *  instead of one. Callers that need a non-default theme must set it BEFORE calling
 *  this — `forceLightMode` is an `addInitScript`, so it has to be registered before
 *  the `goto` below or it never runs.
 *
 *  Moved Phase 88.6.1-20 from `group-settings-danger.spec.ts` to this module so a second
 *  spec (`dialog-focus-floor.spec.ts`) could reuse it; "this file" above means that spec. */
export async function openGroupSettings(page: Page): Promise<void> {
  // Group home hosts the settings entry point (param is `id`, not `groupId`).
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

  // Title-row kebab → Group settings (KebabMenu.js: trigger aria-label
  // "Group actions"). Plan 88.6-16 (D-12) dropped the ARIA menu pattern: the items
  // are plain buttons inside a `<ul role="list">` the trigger names through
  // `aria-controls` while open. The id comes from React's `useId` and contains
  // colons, so it is matched with an attribute selector rather than `#id`.
  const kebab = page.getByRole('button', { name: /group actions/i });
  await expect(kebab).toBeVisible({ timeout: 15_000 });
  await kebab.click();
  const listId = await kebab.getAttribute('aria-controls');
  expect(
    listId,
    'the KebabMenu trigger exposes aria-controls while its menu is open (88.6-16 D-12)',
  ).toBeTruthy();
  await page
    .locator(`[id="${listId}"]`)
    .getByRole('button', { name: /group settings/i })
    .click();

  // The Customize Group modal is mounted.
  await expect(page.getByRole('heading', { name: /customize group/i })).toBeVisible();
}
