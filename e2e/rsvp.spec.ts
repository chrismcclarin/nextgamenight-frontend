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
  /* DECISION Phase 88.6-47 (row 3 of the 2026-09-17 CI e2e red, run 35581508198).
     THE RECORD'S HYPOTHESIS WAS WRONG AND IS RETIRED HERE. `88.6-CI-E2E-RED-2026-09-17.md` guessed
     "stale spec string" / "the D5 latch changing when the text appears". The CI log for run
     35581508198 shows `getByText(/you're (in|going)/i) resolved to 2 elements` — the identical
     STRICT-MODE collision as row 1, on the twin design. The copy is correct and unchanged.

     Both nodes are required and both are now asserted: the visible `<h1>` renders
     `STATUS_CONFIG.yes.heading` (`rsvp/[token]/page.js:50`, rendered at `:293`), and the
     always-mounted polite region composes the same headline into its announcement (`:242`),
     addressed through the shipped `data-testid` at `:416`. Narrowing to the heading is not a
     weakening because the region arm below is new coverage, not a replacement.
     REJECTED — `.first()`: green on a tree with no region at all.
     REJECTED — de-duplicating the page: that duplication is the AC-19 announcement design.
     The ratified regex is untouched on both arms; re-widening to a bare text query re-breaks this. */
  await expect(
    page.getByRole('heading', { level: 1, name: /you're (in|going)/i })
  ).toBeVisible({ timeout: 15_000 });

  /* `toContainText`, NEVER `toBeVisible`: the region is `className="sr-only"`
     (`rsvp/[token]/page.js:415`) and `sr-only` leaves a 1x1 box Playwright calls visible. */
  await expect(page.getByTestId('rsvp-page-status')).toContainText(/you're (in|going)/i, {
    timeout: 15_000,
  });
});
