import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Phase 87.8 Plan 10 — SPEC R7: phone-width coverage of the GroupSettings Danger
 * Zone, the surface most likely to overflow at 375px (it gained impact counts,
 * more copy and a transfer-ownership affordance in the same column during 88.2).
 * PHONE PROJECT ONLY.
 *
 * PROJECT GUARD: every new spec joins BOTH projects automatically — `journeys` and
 * `phone` share `testMatch: /.*\.spec\.ts/` (playwright.config.ts:44 and :87). This
 * file inverts the guard tailwind-v4-styles.spec.ts:59 uses: it SKIPS the desktop
 * `journeys` project, because R7 is a phone-tenet requirement measured at the phone
 * viewport (iPhone SE (3rd gen), 375x667 — D-06).
 *
 * SCOPE OF WHAT THIS SPEC MAY EVER DRIVE: the initial "Delete Group" tap only
 * REVEALS the type-the-group-name gate (setShowDeleteConfirm(true) — no network
 * call). The actual delete requires typing the exact group name AND passing a
 * native confirm() (DECISION Phase 88.2 SPEC-REQ-6, accepted-forever — both gates
 * stay, GroupSettings.js Danger Zone render). This spec never types the group name
 * and never accepts a dialog, so it can never delete the fixture group. Do NOT
 * "extend" it to exercise the delete: that gate is 88.2's, not layout.
 *
 * ENTRY PATH (the way a user reaches it): groupHomePage title-row kebab
 * ("Group actions", CONTEXT D-LEAVE-01 — groupHomePage/page.js:362-371) →
 * "Group settings" menuitem → the Customize Group modal. The Danger Zone renders
 * only for the group OWNER; the CI login identity (Alice) owns the seeded group
 * that scripts/e2e-fixtures.js emits as E2E_GROUP_ID, so it must render here —
 * the vacuity guards assert that instead of silently passing.
 *
 * SELECTOR POLICY: role/label/text only — never Tailwind classes (invite.spec.ts:18).
 * The Danger Zone section has no landmark role, so it is scoped as the parent of
 * its own visible heading (same reasoning as tailwind-v4-styles.spec.ts's
 * documented testid amendment, without adding a testid).
 *
 * NO dark-theme pre-assertion here, deliberately: this file reads GEOMETRY only
 * (bounding boxes, scrollWidth) — never a computed style — and geometry is
 * theme-independent. Adding the D-11 assertion is only required before
 * computed-style reads (tailwind-v4-styles.spec.ts:80-88).
 *
 * Fixtures follow the env-const idiom (tailwind-v4-styles.spec.ts:47-49). Do not
 * run locally — credentials are intentionally absent (playwright.config.ts:19-21);
 * green-in-CI is confirmed at the phase gate in plan 12.
 */

// Seeded group minted by the backend's scripts/e2e-fixtures.js in CI — same env
// fallback convention as e2e/tailwind-v4-styles.spec.ts:49. Param is `id`, not
// `groupId` (tailwind-v4-styles.spec.ts:64-65).
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

/** Vacuity guard (tailwind-v4-styles.spec.ts:139-143 idiom): a zero-count locator
 *  makes every geometry assertion after it vacuous — that is a failure of the
 *  LOCATOR (or of fixture seeding / the owner role), not of the layout. */
async function guardResolved(locator: Locator, what: string): Promise<void> {
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected exactly 1) — a zero-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture/owner-role state, not of the layout`,
  ).toBe(1);
  await expect(locator).toBeVisible();
}

/** The 44px floor on a control's rendered height, with the measured number in the
 *  message. Width is not asserted: every Danger Zone control is `w-full` on phone,
 *  so the horizontal-containment assertions cover the other axis. */
async function assertMinHeight44(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label}: boundingBox() returned null — element not rendered`).not.toBeNull();
  if (!box) return;
  expect(
    box.height,
    `${label} rendered ${box.height}px tall — below the 44px floor. The mechanism is the per-control min-h-11 utility at the call site in GroupSettings.js (converged by plan 87.8-10), not any global .btn rule`,
  ).toBeGreaterThanOrEqual(44);
}

/** Horizontal containment: the control must sit fully inside the viewport width —
 *  reachable without any horizontal scrolling. */
async function assertHorizontallyContained(
  locator: Locator,
  label: string,
  viewportWidth: number,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label}: boundingBox() returned null — element not rendered`).not.toBeNull();
  if (!box) return;
  expect(
    box.x,
    `${label} starts at x=${box.x} — left edge is off-screen, so reaching it needs horizontal scrolling`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${label} right edge at ${box.x + box.width}px exceeds the ${viewportWidth}px viewport — reaching it needs horizontal scrolling`,
  ).toBeLessThanOrEqual(viewportWidth);
}

test.describe('Phase 87.8 R7 — GroupSettings Danger Zone at phone width (phone project)', () => {
  // Inverse of the tailwind-v4-styles.spec.ts:59 guard: this file is phone-only.
  // Both projects match every spec (playwright.config.ts:44, :87), so without this
  // skip the desktop journeys project would run phone-tenet assertions at 1280px.
  test.skip(({ isMobile }) => !isMobile, 'R7 is a phone-tenet requirement — phone project only');

  /** Scope for every Danger Zone locator: the section that owns the visible
   *  "Danger Zone" heading (its direct parent <div> in GroupSettings.js). Scoping
   *  matters — "Cancel" and "Delete Group" both have same-named siblings elsewhere
   *  in the modal once the confirm UI opens. */
  function dangerZone(page: Page): Locator {
    return page.getByRole('heading', { name: /danger zone/i }).locator('xpath=..');
  }

  test.beforeEach(async ({ page }) => {
    // Group home hosts the settings entry point (param is `id`, not `groupId`).
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

    // Title-row kebab → Group settings (KebabMenu.js: trigger aria-label
    // "Group actions", items role="menuitem").
    const kebab = page.getByRole('button', { name: /group actions/i });
    await expect(kebab).toBeVisible({ timeout: 15_000 });
    await kebab.click();
    await page.getByRole('menuitem', { name: /group settings/i }).click();

    // The Customize Group modal is mounted, and the owner-only Danger Zone with it.
    await expect(page.getByRole('heading', { name: /customize group/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /danger zone/i })).toBeVisible();
  });

  test('the Danger Zone renders without horizontal overflow at 375px', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 375;

    // Whole-document check first: any overflowing descendant widens the scrollable
    // area beyond the viewport.
    const docWidths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      docWidths.scrollWidth,
      `document scrollWidth ${docWidths.scrollWidth}px exceeds the ${viewportWidth}px viewport (clientWidth ${docWidths.clientWidth}px) — something on the settings surface forces horizontal overflow at phone width`,
    ).toBeLessThanOrEqual(viewportWidth);

    // Then the Danger Zone container itself: its content must not overflow its own
    // box even if the document-level number happens to pass.
    const zone = dangerZone(page);
    await guardResolved(zone, 'the Danger Zone section (parent of its heading)');
    const zoneWidths = await zone.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(
      zoneWidths.scrollWidth,
      `Danger Zone scrollWidth ${zoneWidths.scrollWidth}px exceeds its clientWidth ${zoneWidths.clientWidth}px — its content overflows the section horizontally at phone width`,
    ).toBeLessThanOrEqual(zoneWidths.clientWidth);
  });

  test('all five Danger Zone controls meet the 44px floor and stay reachable', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 375;
    const zone = dangerZone(page);

    // Controls 1 + 2: the better-path affordance and the initial destructive entry.
    const transferBtn = zone.getByRole('button', { name: /transfer ownership instead/i });
    await guardResolved(transferBtn, 'the "Transfer ownership instead" button');
    await assertMinHeight44(transferBtn, '"Transfer ownership instead"');
    await assertHorizontallyContained(transferBtn, '"Transfer ownership instead"', viewportWidth);

    const deleteEntryBtn = zone.getByRole('button', { name: /delete group/i });
    await guardResolved(deleteEntryBtn, 'the initial "Delete Group" button');
    await assertMinHeight44(deleteEntryBtn, 'the initial "Delete Group" button');
    await assertHorizontallyContained(deleteEntryBtn, 'the initial "Delete Group" button', viewportWidth);

    // Reveal the confirm UI. This is NOT the delete: it only swaps the button for
    // the type-the-group-name gate (see the header note on scope).
    await deleteEntryBtn.click();

    // Control 3: the type-the-group-name input — reachable and focusable without
    // horizontal scrolling.
    const confirmInput = zone.getByPlaceholder(/type group name to confirm/i);
    await guardResolved(confirmInput, 'the type-the-group-name input');
    await assertMinHeight44(confirmInput, 'the type-the-group-name input');
    await assertHorizontallyContained(confirmInput, 'the type-the-group-name input', viewportWidth);
    await confirmInput.click();
    await expect(
      confirmInput,
      'the type-the-group-name input did not receive focus on tap — the gate is unreachable on a phone',
    ).toBeFocused();
    // Nothing is typed — the destructive confirm button stays disabled.

    // Controls 4 + 5: the stacked action pair.
    const cancelBtn = zone.getByRole('button', { name: /cancel/i });
    await guardResolved(cancelBtn, 'the Danger Zone "Cancel" button');
    await assertMinHeight44(cancelBtn, 'the Danger Zone "Cancel" button');
    await assertHorizontallyContained(cancelBtn, 'the Danger Zone "Cancel" button', viewportWidth);

    const confirmDeleteBtn = zone.getByRole('button', { name: /delete group/i });
    await guardResolved(confirmDeleteBtn, 'the confirm-stage "Delete Group" button');
    await assertMinHeight44(confirmDeleteBtn, 'the confirm-stage "Delete Group" button');
    await assertHorizontallyContained(confirmDeleteBtn, 'the confirm-stage "Delete Group" button', viewportWidth);
  });

  test('the two confirm actions stack vertically, not side by side, at 375px', async ({ page }) => {
    const zone = dangerZone(page);

    // Reveal the confirm UI (see the header note — this is not the delete).
    const deleteEntryBtn = zone.getByRole('button', { name: /delete group/i });
    await guardResolved(deleteEntryBtn, 'the initial "Delete Group" button');
    await deleteEntryBtn.click();

    const cancelBtn = zone.getByRole('button', { name: /cancel/i });
    const confirmDeleteBtn = zone.getByRole('button', { name: /delete group/i });
    await guardResolved(cancelBtn, 'the Danger Zone "Cancel" button');
    await guardResolved(confirmDeleteBtn, 'the confirm-stage "Delete Group" button');

    const cancelBox = await cancelBtn.boundingBox();
    const deleteBox = await confirmDeleteBtn.boundingBox();
    expect(cancelBox, 'Cancel boundingBox() returned null').not.toBeNull();
    expect(deleteBox, 'Delete Group boundingBox() returned null').not.toBeNull();
    if (!cancelBox || !deleteBox) return;

    // Pins what the `flex flex-col sm:flex-row` stacking in GroupSettings.js
    // already intends: two side-by-side targets at 375px are cramped, and one of
    // them is destructive. The destructive button must sit fully BELOW Cancel.
    expect(
      deleteBox.y,
      `the confirm-stage "Delete Group" button (top edge ${deleteBox.y}px) does not sit below "Cancel" (bottom edge ${cancelBox.y + cancelBox.height}px) — the pair rendered side by side at phone width instead of stacking`,
    ).toBeGreaterThanOrEqual(cancelBox.y + cancelBox.height);
  });
});
