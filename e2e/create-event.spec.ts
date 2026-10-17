import { test, expect } from '@playwright/test';

import { fillCreateEventManualEntry } from './support/createEvent';

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
 *
 * The open-and-fill steps live in `e2e/support/createEvent.ts` (fillCreateEventManualEntry, moved
 * there by Phase 88.6.1-71); this journey keeps its navigation, submit and closing assertion.
 */
test('user can create an event', async ({ page }) => {
  const groupId = process.env.E2E_GROUP_ID ?? '1';

  // Group home hosts the "Add New Game Event" button (param is `id`).
  await page.goto(`/groupHomePage?id=${groupId}`);

  // Open the create-event modal and fill it by manual entry (the shared drive, not submitted).
  await fillCreateEventManualEntry(page);

  // Submit via the stable test-id added in this plan.
  await page.getByTestId('create-event-submit').click();

  // The modal closes / the event lands on the group surface.
  await expect(page.getByRole('heading', { name: /create event/i })).toBeHidden();
});
