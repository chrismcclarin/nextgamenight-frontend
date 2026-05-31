import { test, expect } from '@playwright/test';

/**
 * Critical journey: create a group (TEST-03).
 *
 * Runs auth-free — the `setup` project (auth.setup.ts) already cached the
 * appSession cookie into the storageState this project reuses (D-05).
 *
 * Selectors are role/label/text/name-attribute only (PATTERNS.md L174) — never
 * Tailwind classes, which churn in Waves 1-5.
 */
test('user can create a group', async ({ page }) => {
  // The create-group modal is launched from the user home group list.
  await page.goto('/userHome');

  // "+ Create New Group" button (grouplist.js: aria-label="Create new group").
  await page.getByRole('button', { name: /create new group/i }).click();

  // Modal form: the group-name input (name="group-name-create" / placeholder "Group Name").
  const groupName = `E2E Group ${Date.now()}`;
  await page.getByPlaceholder('Group Name').fill(groupName);

  // Submit via the "Create Group" button (createGroup.js L121).
  await page.getByRole('button', { name: /^create group$/i }).click();

  // The newly created group surfaces in the UI.
  await expect(page.getByText(groupName)).toBeVisible();
});
