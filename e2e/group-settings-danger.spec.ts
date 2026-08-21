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
 * OPENS the typed-confirmation dialog — no network call. ——— AMENDED Phase 88
 * (original kept as history): the gate used to be an INLINE reveal
 * (setShowDeleteConfirm) stacked with a native confirm() (88.2 SPEC-REQ-6); 88-13
 * removed the native confirm (D-04, COLLISION-1) and 88-33 moved the typed gate
 * + Cancel into <ConfirmDialog> (see the comment above GroupSettings.js's
 * Delete Group button). ONE typed gate now stands, in a Radix dialog titled
 * "Delete {group.name}?" with a bare "Delete" confirm (UI-SPEC §8.7 verb-alone).
 * This spec still never types the group name, so it can never delete the
 * fixture group. Do NOT "extend" it to exercise the delete: that gate is layout
 * out-of-scope here.
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

/** The settings surface lives inside the shared Radix modal since 88-13, and
 *  DialogContent animates `zoom-in-95` over 200ms on open (dialog.tsx:64). A
 *  boundingBox taken mid-animation reads height x scale — the first CI run of
 *  PR #22 measured a true-44px control at 43.565px (= 44 x 0.99) exactly this
 *  way. Settle: poll until two consecutive reads agree, THEN measure. */
async function settleGeometry(locator: Locator): Promise<void> {
  let prev = await locator.boundingBox();
  for (let i = 0; i < 40; i += 1) {
    await locator.page().waitForTimeout(100);
    const next = await locator.boundingBox();
    if (
      prev && next &&
      Math.abs(prev.height - next.height) < 0.01 &&
      Math.abs(prev.width - next.width) < 0.01 &&
      Math.abs(prev.y - next.y) < 0.01
    ) return;
    prev = next;
  }
  throw new Error('geometry never settled after 4s — is an animation looping on this surface?');
}

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
    await settleGeometry(transferBtn); // settings modal zoom-in — see the helper
    await assertMinHeight44(transferBtn, '"Transfer ownership instead"');
    await assertHorizontallyContained(transferBtn, '"Transfer ownership instead"', viewportWidth);

    const deleteEntryBtn = zone.getByRole('button', { name: /delete group/i });
    await guardResolved(deleteEntryBtn, 'the initial "Delete Group" button');
    await assertMinHeight44(deleteEntryBtn, 'the initial "Delete Group" button');
    await assertHorizontallyContained(deleteEntryBtn, 'the initial "Delete Group" button', viewportWidth);

    // Open the confirm dialog. This is NOT the delete: the typed gate lives in
    // <ConfirmDialog> since 88-33 (see the amended header note on scope).
    await deleteEntryBtn.click();
    const dialog = page.getByRole('dialog', { name: /^Delete .*\?$/ });
    await expect(dialog, 'the typed-confirmation dialog must open on Delete Group').toBeVisible();

    // Control 3: the type-the-group-name input — reachable and focusable without
    // horizontal scrolling. The typed tier focuses its input on open (ConfirmDialog
    // contract), and its placeholder is the expected phrase (the group name).
    const confirmInput = dialog.getByRole('textbox');
    await guardResolved(confirmInput, 'the type-the-group-name input');
    await settleGeometry(confirmInput); // the confirm dialog runs its own zoom-in
    await assertMinHeight44(confirmInput, 'the type-the-group-name input');
    await assertHorizontallyContained(confirmInput, 'the type-the-group-name input', viewportWidth);
    await confirmInput.click();
    await expect(
      confirmInput,
      'the type-the-group-name input did not receive focus on tap — the gate is unreachable on a phone',
    ).toBeFocused();
    // Nothing is typed — the destructive confirm button stays disabled.

    // Controls 4 + 5: the dialog's action pair (Cancel + the verb-alone "Delete").
    const cancelBtn = dialog.getByRole('button', { name: 'Cancel' });
    await guardResolved(cancelBtn, 'the confirm dialog "Cancel" button');
    await assertMinHeight44(cancelBtn, 'the confirm dialog "Cancel" button');
    await assertHorizontallyContained(cancelBtn, 'the confirm dialog "Cancel" button', viewportWidth);

    const confirmDeleteBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    await guardResolved(confirmDeleteBtn, 'the confirm-stage "Delete" button');
    await assertMinHeight44(confirmDeleteBtn, 'the confirm-stage "Delete" button');
    await assertHorizontallyContained(confirmDeleteBtn, 'the confirm-stage "Delete" button', viewportWidth);
  });

  test('the confirm actions are uncramped and fully reachable at 375px', async ({ page }) => {
    /* ——— AMENDED Phase 88 (original intent kept as history): this test used to pin
       the INLINE confirm pair stacking vertically (`flex flex-col sm:flex-row` in
       GroupSettings.js) — two side-by-side targets at 375px were cramped because
       both were w-full. 88-33 moved the pair into <ConfirmDialog>, whose
       Modal.Footer renders the fleet-standard side-by-side `justify-end gap-3`
       row of intrinsic-width buttons at every viewport (~37 modals share it).
       The stacking pin therefore no longer has a subject; what SURVIVES of the
       87.8 R7 intent is pinned instead: both actions on the 44px floor, fully
       inside the viewport, destructive verb separated from Cancel by a real gap.
       If the owner wants the dialog footer to stack at phone width, that is a
       Modal.Footer (fleet) decision, not a re-pin here. */
    const viewportWidth = page.viewportSize()?.width ?? 375;
    const zone = dangerZone(page);

    // Open the confirm dialog (see the header note — this is not the delete).
    const deleteEntryBtn = zone.getByRole('button', { name: /delete group/i });
    await guardResolved(deleteEntryBtn, 'the initial "Delete Group" button');
    await deleteEntryBtn.click();
    const dialog = page.getByRole('dialog', { name: /^Delete .*\?$/ });
    await expect(dialog, 'the typed-confirmation dialog must open on Delete Group').toBeVisible();

    const cancelBtn = dialog.getByRole('button', { name: 'Cancel' });
    const confirmDeleteBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    await guardResolved(cancelBtn, 'the confirm dialog "Cancel" button');
    await guardResolved(confirmDeleteBtn, 'the confirm-stage "Delete" button');
    await settleGeometry(cancelBtn); // dialog zoom-in — see the helper

    await assertMinHeight44(cancelBtn, 'the confirm dialog "Cancel" button');
    await assertMinHeight44(confirmDeleteBtn, 'the confirm-stage "Delete" button');
    await assertHorizontallyContained(cancelBtn, 'the confirm dialog "Cancel" button', viewportWidth);
    await assertHorizontallyContained(confirmDeleteBtn, 'the confirm-stage "Delete" button', viewportWidth);

    const cancelBox = await cancelBtn.boundingBox();
    const deleteBox = await confirmDeleteBtn.boundingBox();
    expect(cancelBox, 'Cancel boundingBox() returned null').not.toBeNull();
    expect(deleteBox, 'Delete boundingBox() returned null').not.toBeNull();
    if (!cancelBox || !deleteBox) return;

    // The destructive verb must not abut Cancel: an adjacent-edge gap below 8px
    // makes a mis-tap on the destructive action a one-pixel matter on a phone.
    const gap = deleteBox.x >= cancelBox.x + cancelBox.width
      ? deleteBox.x - (cancelBox.x + cancelBox.width)
      : deleteBox.y - (cancelBox.y + cancelBox.height);
    expect(
      gap,
      `the gap between "Cancel" and the destructive "Delete" is ${gap}px — under 8px, a phone mis-tap lands on the destructive action (Modal.Footer contract is gap-3 = 12px)`,
    ).toBeGreaterThanOrEqual(8);
  });
});
