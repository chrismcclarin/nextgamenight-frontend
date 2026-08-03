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
test('user can RSVP to an event', async ({ page }, testInfo) => {
  // DECISION Phase 87.8 (D-07): the phone project consumes its OWN single-use RSVP
  // link (E2E_RSVP_PATH_PHONE — a second fixture event with its own token batch) —
  // chosen OVER narrowing the phone project's testMatch to exclude this spec (which
  // would silently shrink the MOB-03 gate below "all journeys at phone width"), and
  // OVER weakening single-use semantics or adding a re-mint route: the atomic
  // single-use consume in models/SingleUseToken.js:193-211 is a security control
  // pinned by a backend test, and minting a second token (plan 87.8-02) is the
  // correct fix. WHY a shared link fails: routes/rsvp.js:248 consumes the link's
  // nonce in one atomic UPDATE that returns null on the second call, so the second
  // project's run gets a 403 expired-link and the "already been used" copy — the
  // assertion below fails. LATENT TODAY, before any arming: playwright.config.ts
  // sets retries: 1 in CI, so a first attempt that fails for ANY reason after the
  // auto-submit consumed the nonce guarantees the retry also fails, masking the real
  // cause behind "expired link" — read a red run of this spec attempt-1-first.
  const rsvpPath =
    testInfo.project.name === 'phone'
      ? process.env.E2E_RSVP_PATH_PHONE ?? '/rsvp/seed-rsvp-token-phone?s=yes'
      : process.env.E2E_RSVP_PATH ?? '/rsvp/seed-rsvp-token?s=yes';

  // The RSVP surface is the /rsvp/[token] route + e/u/s query params.
  await page.goto(rsvpPath);

  // The s=yes link auto-responds on load — the confirmation card renders
  // "You're in!" (run 27317492586 screenshot; "you're going" was wrong copy).
  await expect(page.getByText(/you're (in|going)/i)).toBeVisible({ timeout: 15_000 });
});
