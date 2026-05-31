import { test, expect } from '@playwright/test';

/**
 * Critical journey: submit availability (TEST-03).
 *
 * Runs auth-free via the cached storageState (D-05). The availability grid
 * (AvailabilityGrid.js) is painted via the "All" select-all checkbox (label "All",
 * L432-441) — a stable accessible control — to satisfy the "at least one slot"
 * validation without drag mechanics. Submit button text is "Submit Availability"
 * / "Update Availability" (AvailabilityForm.js L348). No Tailwind-class selectors.
 *
 * E2E_AVAILABILITY_TOKEN is a seeded availability magic-link token (provided in CI).
 */
test('user can submit availability', async ({ page }) => {
  const token = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';

  // The availability form is the /availability-form/[token] route.
  await page.goto(`/availability-form/${token}`);

  // Paint slots via the "Select All" checkbox (label "All") so validation passes.
  await page.getByRole('checkbox', { name: /^all$/i }).first().check();

  // Submit via the availability submit button (handles both create + update copy).
  await page.getByRole('button', { name: /submit availability|update availability/i }).click();

  // Confirmation surfaces after a successful submit.
  await expect(
    page.getByText(/availability (saved|submitted|updated)|thank you|success/i)
  ).toBeVisible();
});
