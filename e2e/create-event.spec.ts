import { test, expect } from '@playwright/test';

/**
 * Critical journey: create an event (TEST-03).
 *
 * Runs auth-free via the cached storageState (D-05). Uses the one added test-id
 * (`create-event-submit`, the flagged selector gap — PATTERNS.md L175) for the
 * submit control; everything else is role/text/placeholder.
 *
 * E2E_GROUP_ID points at the seeded group (minted by the backend's
 * scripts/e2e-fixtures.js in CI). The create-event button lives on the GROUP
 * HOME page (`/groupHomePage?id=...`, button "Add New Game Event") — NOT on
 * /groupPlanning, whose CreateEvent mount only opens via email-CTA prefill
 * params (run 27318208981).
 */
test('user can create an event', async ({ page }) => {
  const groupId = process.env.E2E_GROUP_ID ?? '1';

  // Group home hosts the "Add New Game Event" button (param is `id`).
  await page.goto(`/groupHomePage?id=${groupId}`);

  // Open the create-event modal — heading "Create Event" confirms it's mounted.
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

  // Pick a game via the game search combo (placeholder from createEvent.js L647).
  const gameName = process.env.E2E_GAME_NAME ?? 'Catan';
  await page.getByPlaceholder('Search for a game or type a name').fill(gameName);

  // start_date is required (backend Event.start_date NOT NULL) and defaults
  // empty. The modal opens in visual-calendar (drag-select) mode — switch to
  // manual entry and fill the labeled datetime-local input instead.
  await page.getByRole('button', { name: /switch to manual entry/i }).click();
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const startValue = `${start.toISOString().slice(0, 10)}T19:00`;
  await page.getByLabel(/start date & time/i).fill(startValue);

  // Duration is also a required field — native browser validation blocks the
  // submit with "Please fill out this field" (run 27318628271 screenshot).
  await page.getByPlaceholder(/enter duration in minutes/i).fill('120');

  // Submit via the stable test-id added in this plan.
  await page.getByTestId('create-event-submit').click();

  // The modal closes / the event lands on the group surface.
  await expect(page.getByRole('heading', { name: /create event/i })).toBeHidden();
});
