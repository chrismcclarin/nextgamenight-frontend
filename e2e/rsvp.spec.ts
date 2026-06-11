import { test, expect } from '@playwright/test';

/**
 * Critical journey: RSVP to an event (TEST-03).
 *
 * Runs auth-free via the cached storageState (D-05). RSVP status buttons render
 * their label text directly (RsvpSection.js L102/111/120 → "Yes"/"Maybe"/"No"),
 * so role+name selectors are stable. No Tailwind-class selectors.
 *
 * E2E_RSVP_PATH is the full email-link path — /rsvp/<hmac>?e=<event>&u=<user>&s=yes
 * — minted by the backend's scripts/e2e-fixtures.js in CI. The page reads e/u/s
 * from the query string and auto-submits the RSVP on load (it's the email's
 * one-click flow), so the journey asserts the confirmation rather than clicking.
 */
test('user can RSVP to an event', async ({ page }) => {
  const rsvpPath = process.env.E2E_RSVP_PATH ?? '/rsvp/seed-rsvp-token?s=yes';

  // The RSVP surface is the /rsvp/[token] route + e/u/s query params.
  await page.goto(rsvpPath);

  // The s=yes link auto-responds on load — the confirmation card renders
  // "You're in!" (run 27317492586 screenshot; "you're going" was wrong copy).
  await expect(page.getByText(/you're (in|going)/i)).toBeVisible({ timeout: 15_000 });
});
