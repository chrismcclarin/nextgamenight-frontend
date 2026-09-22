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

  /* DECISION Phase 88.6-47 (row 1 of the 2026-09-17 CI e2e red, run 35581508198).
     THE DUPLICATION IS THE DESIGN, AND BOTH NODES ARE NOW REQUIRED.

     This assertion used to be a bare text query, and it failed with a Playwright STRICT-MODE
     violation — "resolved to 2 elements" — never with a visibility timeout. The page renders the
     confirmation sentence twice ON PURPOSE: the visible `<h1>` (`availability-form/[token]/page.js:337`,
     from the `SUBMITTED_HEADLINE` constant at `:26`) and the always-mounted polite region AC-19 put
     on the page, which composes the SAME headline into its announcement (`:271`). The page's own
     marker at `:452` says in as many words that the `data-testid` exists because a bare role query
     matches two nodes. So the TEST moves, not the page.

     Narrowing to the heading is NOT a weakening, because the second assertion below asserts the
     region explicitly — that is the point of this change. It converts an accidental collision into
     a deliberate two-node contract, and it is the first e2e coverage the AC-19 announcement has had.
     The ratified regex is unchanged on BOTH arms: pinning an exact string here would re-pin copy
     this phase does not own.
     REJECTED — `.first()` on the bare text query: it passes whichever node Playwright returns first,
     so it would go green on a tree where the region had been deleted.
     REJECTED — making the region not duplicate on-screen text: that is the AC-19 design, recorded at
     the two sites above.
     Re-widening either arm back to a bare text query re-breaks this test. */
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /availability (saved|submitted|updated)|thank you|success/i,
    })
  ).toBeVisible();

  /* The live region carries the same sentence. `toContainText`, NEVER `toBeVisible`: the region is
     `className="sr-only"` (`availability-form/[token]/page.js:451`), and `sr-only` leaves a 1x1 box
     that Playwright reports as VISIBLE — a visibility assertion here would pass while proving
     nothing about the announcement. */
  await expect(page.getByTestId('availability-page-status')).toContainText(
    /availability (saved|submitted|updated)|thank you|success/i
  );
});
