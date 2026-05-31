import { test, expect } from '@playwright/test';

/**
 * Critical journey: RSVP to an event (TEST-03).
 *
 * Runs auth-free via the cached storageState (D-05). RSVP status buttons render
 * their label text directly (RsvpSection.js L102/111/120 → "Yes"/"Maybe"/"No"),
 * so role+name selectors are stable. No Tailwind-class selectors.
 *
 * E2E_RSVP_TOKEN is a seeded RSVP magic-link token (provided in CI).
 */
test('user can RSVP to an event', async ({ page }) => {
  const token = process.env.E2E_RSVP_TOKEN ?? 'seed-rsvp-token';

  // The RSVP surface is the /rsvp/[token] route.
  await page.goto(`/rsvp/${token}`);

  // Click the "Yes" status button (RsvpSection.js renders config.buttonText).
  await page.getByRole('button', { name: /^yes$/i }).click();

  // The selection persists — the "going" confirmation copy appears
  // (statusConfig.yes.label === "You're going!").
  await expect(page.getByText(/you're going/i)).toBeVisible();
});
