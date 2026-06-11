import { test, expect } from '@playwright/test';

/**
 * Critical journey: create an event (TEST-03).
 *
 * Runs auth-free via the cached storageState (D-05). Uses the one added test-id
 * (`create-event-submit`, the flagged selector gap — PATTERNS.md L175) for the
 * submit control; everything else is role/text/placeholder.
 *
 * E2E_GROUP_ID points at a seeded group whose planning surface hosts the
 * create-event modal (provided in CI alongside the seed step).
 */
test('user can create an event', async ({ page }) => {
  const groupId = process.env.E2E_GROUP_ID ?? '1';

  // Group planning surface hosts the create-event modal. The page reads the
  // snake_case `group_id` search param (groupPlanning/page.js L17) — camelCase
  // `groupId` rendered "No group specified" (run 27317492586 screenshot).
  await page.goto(`/groupPlanning?group_id=${groupId}`);

  // Open the create-event modal — heading "Create Event" confirms it's mounted.
  await page.getByRole('button', { name: /create event|new event|add event/i }).first().click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

  // Pick a game via the game search combo (placeholder from createEvent.js L647).
  const gameName = process.env.E2E_GAME_NAME ?? 'Catan';
  await page.getByPlaceholder('Search for a game or type a name').fill(gameName);

  // Submit via the stable test-id added in this plan.
  await page.getByTestId('create-event-submit').click();

  // The modal closes / the event lands on the planning surface.
  await expect(page.getByRole('heading', { name: /create event/i })).toBeHidden();
});
