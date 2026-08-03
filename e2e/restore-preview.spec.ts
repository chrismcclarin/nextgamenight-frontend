import { test, expect, type Locator } from '@playwright/test';

/**
 * Phase 87.8 Plan 10 — SPEC R7: phone-width coverage of the group-restore
 * PREVIEW state at /restore/group/[token]. PHONE PROJECT ONLY.
 *
 * PROJECT GUARD: every new spec joins BOTH projects automatically — `journeys` and
 * `phone` share `testMatch: /.*\.spec\.ts/` (playwright.config.ts:44 and :87). This
 * file inverts the guard tailwind-v4-styles.spec.ts:59 uses: it SKIPS the desktop
 * `journeys` project, because R7 is a phone-tenet requirement measured at the phone
 * viewport (iPhone SE (3rd gen), 375x667 — D-06).
 *
 * THE PREVIEW STATE IS THE POINT (87.8-RESEARCH.md Pitfall 6): without the backend
 * fixture this spec could only ever reach the error branch, which exercises almost
 * none of the surface at risk — the preview layout is what had never been seen at
 * 375px. E2E_RESTORE_PATH is the emailed-link path shape /restore/group/<nonce>,
 * minted by the backend's scripts/e2e-fixtures.js in CI (the `restore_path` key of
 * E2E_FIXTURES_JSON, 87.8-02): a soft-deleted memberless group with a future
 * purge_after and an active group_restore nonce, which is exactly the state that
 * renders the PREVIEW branch (routes/groups.js:713-714) — not already_restored,
 * not a 404. Every test therefore asserts the preview rendered BEFORE any
 * geometry, so a spec that lands on the error branch fails loudly instead of
 * measuring the wrong surface.
 *
 * NEVER CLICK "Take over this group" HERE. The tap fires the acceptance POST
 * (DECISION Phase 88.2 M-3 — the tap, not the page load, transfers ownership) and
 * the acceptance is single-shot per D-02: it would consume the one fixture nonce
 * and mutate the fixture group for every later run in the job. Presence and
 * geometry only — the state machine is 88.2's and out of this spec's scope.
 *
 * SELECTOR POLICY: role/label/text only — never Tailwind classes (invite.spec.ts:18).
 *
 * Fixtures follow the env idiom of e2e/rsvp.spec.ts (backend-minted single-use
 * token path with an obviously-fake fallback). Do not run locally — credentials
 * and MAGIC_TOKEN_SECRET are intentionally absent (playwright.config.ts:19-21,
 * e2e-fixtures.js:32); green-in-CI is confirmed at the phase gate in plan 12.
 */

// Minted by the backend's scripts/e2e-fixtures.js in CI (restore_path →
// E2E_RESTORE_PATH, wired by plan 87.8-09's guarded jq -e extraction). The
// fallback is an obviously-fake nonce that can only ever reach the error state.
const RESTORE_PATH = process.env.E2E_RESTORE_PATH ?? '/restore/group/seed-restore-nonce-fallback';

/** Vacuity guard (tailwind-v4-styles.spec.ts:139-143 idiom): a zero-count locator
 *  makes every geometry assertion after it vacuous — that is a failure of the
 *  LOCATOR (or of the fixture nonce), not of the layout. */
async function guardResolved(locator: Locator, what: string): Promise<void> {
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected exactly 1) — a zero-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture state, not of the layout`,
  ).toBe(1);
  await expect(locator).toBeVisible();
}

test.describe('Phase 87.8 R7 — group-restore preview at phone width (phone project)', () => {
  // Inverse of the tailwind-v4-styles.spec.ts:59 guard: this file is phone-only.
  // Both projects match every spec (playwright.config.ts:44, :87), so without this
  // skip the desktop journeys project would run phone-tenet assertions at 1280px.
  test.skip(({ isMobile }) => !isMobile, 'R7 is a phone-tenet requirement — phone project only');

  test.beforeEach(async ({ page }) => {
    await page.goto(RESTORE_PATH);

    // PREVIEW-STATE ASSERTION, before anything else (Pitfall 6): the preview
    // branch uniquely renders the "Bring this group back" lead-in, the group name
    // as the page's h1, and — for the signed-in storageState identity — the
    // explicit take-over action (M-3). If any of these fail, the spec reached the
    // error/already-restored branch and every geometry number below would be
    // measured on the wrong surface. 15s explicit timeout on the first
    // post-navigation assertion (rsvp.spec.ts idiom).
    await expect(page.getByText(/bring this group back/i)).toBeVisible({ timeout: 15_000 });
    const groupName = page.getByRole('heading', { level: 1 });
    await expect(groupName).toBeVisible();
    await expect(groupName).not.toBeEmpty();
    // Presence only — see the header warning. NEVER click this button.
    await expect(page.getByRole('button', { name: /take over this group/i })).toBeVisible();
  });

  test('the preview state renders without horizontal overflow at 375px', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 375;

    const docWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      docWidths.scrollWidth,
      `document scrollWidth ${docWidths.scrollWidth}px exceeds the ${viewportWidth}px viewport (clientWidth ${docWidths.clientWidth}px) — the restore preview forces horizontal overflow at phone width`,
    ).toBeLessThanOrEqual(viewportWidth);
  });

  test('every visible restore action meets the 44px floor', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 375;

    // The signed-in preview renders exactly one action: the explicit take-over
    // button (M-3). Presence was asserted in beforeEach; measure it here.
    const takeOverBtn = page.getByRole('button', { name: /take over this group/i });
    await guardResolved(takeOverBtn, 'the "Take over this group" button');

    const box = await takeOverBtn.boundingBox();
    expect(box, '"Take over this group": boundingBox() returned null — element not rendered').not.toBeNull();
    if (!box) return;
    expect(
      box.height,
      `"Take over this group" rendered ${box.height}px tall — below the 44px floor. The mechanism is the per-control min-h-11 utility at the call site in restore/group/[token]/page.tsx (converged by plan 87.8-10), not any global .btn rule`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      box.x,
      `"Take over this group" starts at x=${box.x} — left edge is off-screen at phone width`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box.x + box.width,
      `"Take over this group" right edge at ${box.x + box.width}px exceeds the ${viewportWidth}px viewport`,
    ).toBeLessThanOrEqual(viewportWidth);
  });

  test('the group name wraps instead of forcing overflow', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 375;

    const groupName = page.getByRole('heading', { level: 1 });
    await guardResolved(groupName, 'the group-name h1 on the preview');

    // D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:80-88) before the
    // computed-style read below: a style read in light mode would be meaningless
    // and its failure misdiagnosed.
    await expect(page.locator('html')).toHaveClass(/dark/);

    // The fixture group name is short, so a purely geometric check could pass while
    // the wrap MECHANIC is broken for a long real-world name. Assert the mechanic
    // itself: the h1 carries wrap-break-word, which must compute to
    // overflow-wrap: break-word — a long unbroken name then wraps inside the card
    // instead of pushing the layout wide.
    const overflowWrap = await groupName.evaluate((node) => getComputedStyle(node).overflowWrap);
    expect(
      overflowWrap,
      `the group-name h1 computes overflow-wrap: ${overflowWrap}, expected break-word — a long unbroken group name would force horizontal overflow instead of wrapping`,
    ).toBe('break-word');

    // And the rendered box itself stays inside the viewport.
    const box = await groupName.boundingBox();
    expect(box, 'group-name h1: boundingBox() returned null — element not rendered').not.toBeNull();
    if (!box) return;
    expect(
      box.x + box.width,
      `the group-name h1 right edge at ${box.x + box.width}px exceeds the ${viewportWidth}px viewport — the name is pushing the layout instead of wrapping`,
    ).toBeLessThanOrEqual(viewportWidth);
  });
});
