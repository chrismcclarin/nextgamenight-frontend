import { test, expect, type Locator, type Page } from '@playwright/test';

import { assertTheme, forceLightMode } from './support/contrast';

/**
 * Phase 87.8 Plan 10 — SPEC R7: phone-width coverage of the GroupSettings Danger
 * Zone, the surface most likely to overflow at 375px (it gained impact counts,
 * more copy and a transfer-ownership affordance in the same column during 88.2).
 * PHONE PROJECT ONLY.
 *
 * ——— EXTENDED Phase 88.3.1 (plan 10, SPEC Req 7): this file also now measures the
 * eight COLOUR SWATCHES, which live in the same Customize Group modal and are
 * reached by the same kebab path. Req 7 adds STEPS, it does not add a spec — the
 * entry path, the phone-only guard and `settleGeometry` were already here and
 * already green, and a second file would have duplicated all three. The swatch
 * block is the second `test.describe` at the bottom.
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
 * ——— AMENDED Phase 88.3.1 (plan 10), and the amendment is narrow: the paragraph
 * above still holds for the Danger Zone block, which asserts no theme. The SWATCH
 * block DOES call `assertTheme` — for a different reason than the D-11 one. It
 * measures the same geometry TWICE, once per theme, to establish that geometry is
 * theme-independent rather than assuming it. Both Playwright projects are
 * `colorScheme: 'dark'` (playwright.config.ts:131), so without the pre-assertion
 * the "light" run would silently be a second dark run and the pair of tests would
 * prove nothing. The assertion there is a VACUITY guard, not a style guard.
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

/** Vacuity guard (tailwind-v4-styles.spec.ts:139-143 idiom): a wrong-count locator
 *  makes every geometry assertion after it vacuous — that is a failure of the
 *  LOCATOR (or of fixture seeding / the owner role), not of the layout.
 *
 *  ——— GENERALISED Phase 88.3.1 (plan 10): the count is now a parameter. The swatch
 *  grid needs the SAME guard at n = 8, and a count of 7 there is exactly as vacuous
 *  as a count of 0 is here — it would mean a preset silently vanished from the
 *  picker while every surviving box still measured 64x64 and the test stayed green
 *  (threat T-88.3.1-26). Copying the helper to take a second count was the
 *  alternative and is the duplication the project tenet forbids. */
async function guardResolvedCount(locator: Locator, what: string, expected: number): Promise<void> {
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected exactly ${expected}) — a wrong-count locator makes the geometry assertion vacuous; this is a failure of the LOCATOR or the fixture/owner-role state, not of the layout`,
  ).toBe(expected);
}

/** The single-element case, which is every Danger Zone control. */
async function guardResolved(locator: Locator, what: string): Promise<void> {
  await guardResolvedCount(locator, what, 1);
  await expect(locator).toBeVisible();
}

/** The kebab entry path, shared by both describes in this file.
 *
 *  Extracted Phase 88.3.1 (plan 10) from the Danger Zone `beforeEach`, unchanged in
 *  behaviour: the swatch block reaches the SAME modal by the SAME path, and a second
 *  copy of these six lines would be two things to keep in step with `KebabMenu.js`
 *  instead of one. Callers that need a non-default theme must set it BEFORE calling
 *  this — `forceLightMode` is an `addInitScript`, so it has to be registered before
 *  the `goto` below or it never runs. */
async function openGroupSettings(page: Page): Promise<void> {
  // Group home hosts the settings entry point (param is `id`, not `groupId`).
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

  // Title-row kebab → Group settings (KebabMenu.js: trigger aria-label
  // "Group actions", items role="menuitem").
  const kebab = page.getByRole('button', { name: /group actions/i });
  await expect(kebab).toBeVisible({ timeout: 15_000 });
  await kebab.click();
  await page.getByRole('menuitem', { name: /group settings/i }).click();

  // The Customize Group modal is mounted.
  await expect(page.getByRole('heading', { name: /customize group/i })).toBeVisible();
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
    // Shared kebab path (see `openGroupSettings`); the owner-only Danger Zone is
    // mounted with the modal.
    await openGroupSettings(page);
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

/* ————————————————————————————————————————————————————————————————————————————
 * Phase 88.3.1 plan 10 — SPEC Req 7: THE EIGHT COLOUR SWATCHES, MEASURED.
 *
 * DECISION Phase 88.3.1 (SPEC Req 7): Req 7's acceptance is a MEASUREMENT taken in
 * a real browser, chosen OVER the arithmetic in UI-SPEC §5.1. That table was
 * calculated, `88.3.1-RESEARCH.md` flagged it UNVERIFIED for exactly that reason,
 * and it turned out to be wrong in three places — plan 07 measured the grid at
 * 327px (the table said ~311), the cell pitch at 75.75px (~71.8) and the 320px chip
 * at 62px (~58), because the real Modal chrome is `w-[calc(100%-1.5rem)]` +
 * ModalBody `p-3`. All three errors were in the safe direction, which is precisely
 * why arithmetic cannot be the gate: it was wrong AND it passed.
 *
 * These tests live in this file rather than a new one because Req 7 adds STEPS to
 * an existing surface: same modal, same kebab entry path, same phone-only guard,
 * same `settleGeometry`. A new spec would have duplicated all four.
 *
 * NOT AFFECTED, stated because it looks like it should be: `scripts/
 * gate-c-executed-floor.mjs`'s `FLOOR = 13` is bound to `e2e/contrast.spec.ts`
 * (its `SPEC` const, and the lockstep test at `src/lib/ci-grep-gate.fixture.test.ts
 * :745-749`), NOT to the phone project's total. Adding tests here cannot move it,
 * and removing a contrast.spec.ts test still reds it. Plan 10's own text read that
 * floor as a project-wide count; it is per-file.
 * ———————————————————————————————————————————————————————————————————————————— */

/** The eight accessible names, in render order. These are `preset.label` values
 *  (`src/lib/groupColourPresets.ts`), carried onto each button as `aria-label`; the
 *  visible caption beside them is `aria-hidden` (AMENDMENT G2) so the name is
 *  announced exactly once. Asserting them by NAME is what proves the aria wiring
 *  survived plan 07's rebuild — a grid of eight nameless boxes would still pass
 *  every geometry assertion below. */
const PRESET_LABELS = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Violet', 'Rose'] as const;

/** The picker's labelled set: `role="group"` + `aria-labelledby="group-colour-choice"`,
 *  whose visible label is the "Choose a default color:" paragraph
 *  (`GroupSettings.js:587,592`). Role/label only — never a Tailwind class (:34). */
function swatchGrid(page: Page): Locator {
  return page.getByRole('group', { name: /choose a default color/i });
}

/** The 44x44 floor on BOTH axes, with the measured numbers in the message — the way
 *  the 43.565px incident was diagnosed. Distinct from `assertMinHeight44` above,
 *  which deliberately asserts one axis because every Danger Zone control is `w-full`. */
async function assertSwatchFloor(locator: Locator, label: string): Promise<void> {
  await settleGeometry(locator); // mandatory — see the helper, never a bare boundingBox()
  const box = await locator.boundingBox();
  expect(box, `swatch "${label}": boundingBox() returned null — element not rendered`).not.toBeNull();
  if (!box) return;
  expect(
    box.width,
    `swatch "${label}" rendered ${box.width}px wide x ${box.height}px tall — width is below the 44px floor. The mechanism is the per-site 'w-full max-w-16 aspect-square min-w-11 min-h-11' string in GroupSettings.js (DECISION Phase 88.3.1, SPEC Req 7); 64 is the target, 44 is what must never be breached`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box.height,
    `swatch "${label}" rendered ${box.width}px wide x ${box.height}px tall — height is below the 44px floor. Same mechanism as the width message above; if height alone fails, suspect 'aspect-square' was dropped (a stretched grid item measures 72 x 44 at 375px: it clears the floor in one axis and stops reading as a colour chip)`,
  ).toBeGreaterThanOrEqual(44);
}

/** Every swatch measured, plus the count and accessible-name vacuity guards. */
async function measureAllSwatches(page: Page): Promise<void> {
  const grid = swatchGrid(page);
  await guardResolved(grid, 'the "Choose a default color" swatch group');

  const swatches = grid.getByRole('button');
  await guardResolvedCount(swatches, 'the eight colour swatches inside the picker group', 8);

  for (const label of PRESET_LABELS) {
    const swatch = grid.getByRole('button', { name: label, exact: true });
    await guardResolved(swatch, `the "${label}" swatch (by accessible name)`);
    await assertSwatchFloor(swatch, label);
  }
}

/** The picker's own overflow pair, in the shape of the Danger Zone test above. */
async function assertGridDoesNotScroll(page: Page, viewportWidth: number): Promise<void> {
  const grid = swatchGrid(page);
  const widths = await grid.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }));
  expect(
    widths.scrollWidth,
    `swatch grid scrollWidth ${widths.scrollWidth}px exceeds its clientWidth ${widths.clientWidth}px at a ${viewportWidth}px viewport — the four-column picker overflows its own box, so a swatch is only reachable by scrolling sideways (SPEC Req 7)`,
  ).toBeLessThanOrEqual(widths.clientWidth);
}

test.describe('Phase 88.3.1 Req 7 — the eight colour swatches at phone width (phone project)', () => {
  // Same inverse guard as the Danger Zone block: Req 7 is a phone-tenet
  // requirement, and both projects match every spec (playwright.config.ts:44, :87).
  test.skip(({ isMobile }) => !isMobile, 'Req 7 is a phone-tenet requirement — phone project only');

  test.describe('dark mode (both Playwright projects default to it)', () => {
    test.beforeEach(async ({ page }) => {
      await openGroupSettings(page);
      // Vacuity guard, not a style guard — see the amended header note. Without it
      // the light block below could silently be a second dark run.
      await assertTheme(page, 'dark');
    });

    test('all eight swatches clear the 44x44 floor at 375px, with settled geometry', async ({ page }) => {
      await measureAllSwatches(page);
    });

    test('the picker does not force horizontal scroll at 375px', async ({ page }) => {
      const viewportWidth = page.viewportSize()?.width ?? 375;

      // Settle before reading any width: the modal animates `zoom-in-95` over 200ms
      // and a mid-animation scrollWidth is as wrong as a mid-animation box.
      const grid = swatchGrid(page);
      await guardResolved(grid, 'the "Choose a default color" swatch group');
      await settleGeometry(grid);

      await assertGridDoesNotScroll(page, viewportWidth);

      // And the document, because an overflowing descendant widens the scrollable
      // area past the viewport even when the grid's own numbers pass.
      const docWidths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        docWidths.scrollWidth,
        `document scrollWidth ${docWidths.scrollWidth}px exceeds the ${viewportWidth}px viewport (clientWidth ${docWidths.clientWidth}px) while the colour picker is open`,
      ).toBeLessThanOrEqual(viewportWidth);
    });

    /* AMENDMENT X (plan-review 2026-08-29, owner-resolved): MEASURE at 320px — the
       amendment previously offered "measure it or strike the claim" and that
       ambiguity is withdrawn. `success_criteria` asserts the picker does not force
       horizontal scroll at 375px OR 320px, and the phone project is iPhone SE at
       375x667, so nothing else in this suite touches 320. The M32 reversal makes
       320 the harder case, not the easier one: every chip now carries a caption
       beneath it (AMENDMENT G2), so the grid grew 80px -> 176px tall at the
       narrowest width UI-SPEC §5.1's table covers.

       SCOPE, deliberately narrow: this asserts the GRID, not the document. 320px is
       outside the project's measured viewport — a document-level overflow there
       would be an unrelated finding on some other surface, and asserting it here
       would red this test for something Req 7 does not own. The grid is the claim. */
    test('the picker does not force horizontal scroll at 320px either (AMENDMENT X)', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });

      const grid = swatchGrid(page);
      await guardResolved(grid, 'the "Choose a default color" swatch group at 320px');
      await settleGeometry(grid); // re-settle: the modal is `w-[calc(100%-1.5rem)]` and reflows

      await assertGridDoesNotScroll(page, 320);

      // The cap stops binding here — measured 62 x 62, still clear of the floor.
      const swatches = grid.getByRole('button');
      await guardResolvedCount(swatches, 'the eight colour swatches at 320px', 8);
      await assertSwatchFloor(
        grid.getByRole('button', { name: 'Red', exact: true }),
        'Red @320px',
      );
      await assertSwatchFloor(
        grid.getByRole('button', { name: 'Rose', exact: true }),
        'Rose @320px',
      );
    });

    /* DECISION Phase 88.3.1 (plan 10): the grid's `justify-items-center` gets its OWN
       assertion, chosen OVER relying on the per-swatch boxes and the grid
       scrollWidth above. Plan 07 MEASURED both ways and wrote the finding into
       `GroupSettings.js`: without the centring utility each chip sits at offset 0.00
       in its 75.75px column, leaving 11.75px dead at the trailing edge — eight chips
       hugging the inline start, optically uneven — and BOTH of the other assertions
       pass under that misalignment. So the class is load-bearing and, as originally
       planned, nothing downstream caught it.

       The mechanism: the cell wrapper is `w-full max-w-16`, so it resolves to 64px
       inside a 75.75px column and `justify-items-center` centres it (offset 5.88px).
       Asserting the ROW is symmetric inside the grid is the cheapest thing that
       reds on removal and does not pin the exact pitch — the pitch is a consequence
       of the Modal chrome and would make this test brittle to unrelated padding.
       A decision, not a cleanup. */
    test('the swatch row is centred in its grid — justify-items-center is live', async ({ page }) => {
      const grid = swatchGrid(page);
      await guardResolved(grid, 'the "Choose a default color" swatch group');
      await settleGeometry(grid);

      const first = grid.getByRole('button', { name: 'Red', exact: true });
      const last = grid.getByRole('button', { name: 'Green', exact: true }); // 4th = end of row 1
      await settleGeometry(first);

      const gridBox = await grid.boundingBox();
      const firstBox = await first.boundingBox();
      const lastBox = await last.boundingBox();
      expect(gridBox, 'swatch grid boundingBox() returned null').not.toBeNull();
      expect(firstBox, 'first swatch boundingBox() returned null').not.toBeNull();
      expect(lastBox, 'fourth swatch boundingBox() returned null').not.toBeNull();
      if (!gridBox || !firstBox || !lastBox) return;

      // Row 1 must be Red..Green — if the grid ever stops being 4 columns this
      // reads two chips from different rows and the numbers below are meaningless.
      expect(
        Math.abs(firstBox.y - lastBox.y),
        `the 1st and 4th swatches are on different rows (y ${firstBox.y} vs ${lastBox.y}) — the picker is no longer grid-cols-4, so this centring measurement has no subject`,
      ).toBeLessThan(1);

      const leadInset = firstBox.x - gridBox.x;
      const trailInset = gridBox.x + gridBox.width - (lastBox.x + lastBox.width);
      expect(
        Math.abs(leadInset - trailInset),
        `the swatch row is not centred in its grid: ${leadInset}px of slack at the leading edge vs ${trailInset}px at the trailing edge. Expected both ~5.88px at 375px. This is what dropping 'justify-items-center' from the grid looks like (leading 0.00, trailing 11.75) — the per-swatch boxes and the grid scrollWidth both PASS under that misalignment, which is why this assertion exists`,
      ).toBeLessThan(1);
    });
  });

  test.describe('light mode', () => {
    test.beforeEach(async ({ page }) => {
      // `forceLightMode` is an addInitScript — it MUST be registered before the
      // goto inside `openGroupSettings`, or the baked storageState wins.
      await forceLightMode(page);
      await openGroupSettings(page);
      await assertTheme(page, 'light');
    });

    /* Geometry SHOULD be theme-independent — the light/dark fork here is a colour
       fork in the CSS cascade (`bg-[var(--group-ground-light)] dark:bg-[…]`), which
       cannot move a box. Measuring it in both themes anyway is how we find out that
       it is, rather than assuming it; the phone project pins `colorScheme: 'dark'`,
       so light mode was the theme this suite had never measured the picker in. */
    test('all eight swatches clear the 44x44 floor at 375px in light mode too', async ({ page }) => {
      await measureAllSwatches(page);
    });

    test('the picker does not force horizontal scroll at 375px in light mode', async ({ page }) => {
      const viewportWidth = page.viewportSize()?.width ?? 375;
      const grid = swatchGrid(page);
      await guardResolved(grid, 'the "Choose a default color" swatch group');
      await settleGeometry(grid);
      await assertGridDoesNotScroll(page, viewportWidth);
    });
  });
});
