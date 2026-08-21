import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 87.8 Plan 05 — SPEC R3: feedback trigger placement + stacking (D-09/D-10).
 *
 * What this file guards, and why each assertion has the shape it has:
 *
 *   1. Below `md` the floating feedback button (FAB) must not render. Asserted
 *      against COMPUTED display, never class tokens — `.btn` is UNLAYERED in
 *      globals.css and an unlayered declaration beats any layered Tailwind
 *      utility, so a `hidden` class CAN be present in the markup while the
 *      element stays visible (the exact failure Plan 05 Task 2 fixed with a
 *      bare wrapper div). A class-token check would pass while the bug ships.
 *   2. The phone nav menu carries a "Send feedback" row that opens the SAME
 *      modal instance mounted at the layout root. If the modal were mounted
 *      inside the nav dropdown, the dropdown's computed `translate` would make
 *      it the containing block for position:fixed, clipping the surface to ~the
 *      dropdown's height. Phase 88-17 moved the modal onto the shared <Modal>
 *      (a portalled Radix dialog), so the guard is now stated against the
 *      dialog's ancestor chain and centre rather than an overlay's height —
 *      see measureModalSurface below for why, in full.
 *   3. The FAB must sit BELOW every overlay (z-30 vs the z-index 40/50 tiers;
 *      the shared dialog and its backdrop both sit at z-50).
 *      Asserted behaviourally via elementFromPoint, not by reading a z-index.
 *   4. Logged-out visitors get NEITHER entry point — a real render assertion
 *      in a fresh unauthenticated context, replacing the old grep-only check.
 *
 * SELECTOR POLICY: role/label/text only — never Tailwind classes (invite.spec.ts
 * idiom). The FAB and the nav row share the accessible name "Send feedback"
 * (the FAB via aria-label on an icon-only button, the row via visible text),
 * so an unscoped getByRole matches BOTH and is ambiguous. Scoping used here:
 * the ROW is the match with visible text ("Send feedback" as textContent);
 * the FAB is the match with NO visible text (icon-only). Each lookup carries a
 * vacuity guard (exact count), so a broken selector cannot pass silently.
 * Structural DOM walks (parentElement / closest) happen only inside
 * page.evaluate for computed-style/hit-testing reads — the same idiom
 * tailwind-v4-styles.spec.ts uses for stylesheet walking.
 */

// Seeded group minted by the backend's scripts/e2e-fixtures.js in CI — same env
// fallback convention as e2e/create-event.spec.ts:17 and tailwind-v4-styles.spec.ts:49.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// FAB: icon-only button (accessible name from aria-label, no text content).
// includeHidden because on phone the wrapper computes display:none, which
// removes the button from the accessibility tree — the whole point is to
// find it anyway and assert on COMPUTED style.
const fabLocator = (page: Page) =>
  page
    .getByRole('button', { name: 'Send feedback', includeHidden: true })
    .filter({ hasNotText: 'Send feedback' });

// Nav row: the variant with "Send feedback" as visible text (its label span).
const navRowLocator = (page: Page, opts: { includeHidden?: boolean } = {}) =>
  page
    .getByRole('button', { name: 'Send feedback', includeHidden: opts.includeHidden ?? false })
    .filter({ hasText: 'Send feedback' });

// The feedback modal's own heading — <Modal.Header>'s DialogTitle since 88-17.
const modalHeading = (page: Page) => page.getByRole('heading', { name: 'Send Feedback' });

/**
 * Containing-block probe (rewritten in Phase 88-17, Req 9).
 *
 * WHAT IT GUARDS IS UNCHANGED: the feedback modal must resolve its
 * position:fixed geometry against the VIEWPORT, never against the nav
 * dropdown. If the modal were rendered inside that dropdown, the dropdown's
 * computed `translate` would become its containing block and the surface would
 * be clipped to a ~200px strip (RESEARCH Pitfall 1).
 *
 * WHY THE SHAPE CHANGED: pre-88-17 the modal was a hand-rolled `inset: 0`
 * backdrop, so "climb to the first position:fixed ancestor, assert it fills the
 * viewport" measured the guard directly. The shared <Modal> is a Radix dialog:
 * it portals to <body> and its fixed element is the CENTERED content surface,
 * which is deliberately NOT viewport-sized. A height assertion against that
 * element would fail on a correct tree — so the guard is restated at its own
 * level instead of being deleted:
 *   1. no ancestor between the dialog and <body> establishes a containing block
 *      for fixed descendants (transform / translate / filter / perspective) —
 *      the direct, mechanism-level statement of the bug;
 *   2. the dialog's centre is the VIEWPORT's centre, which is where
 *      `left:50%/top:50% + translate(-50%,-50%)` lands only when the viewport is
 *      the containing block — the behavioural half.
 * Reverting this to a height check is a decision, not a cleanup.
 *
 * `closest('[role="dialog"]')` is role-based, so it stays inside the file's
 * selector policy; the DOM walk happens in evaluate because locators cannot
 * ascend.
 */
async function measureModalSurface(page: Page) {
  return modalHeading(page).evaluate((heading) => {
    const dialog = (heading as HTMLElement).closest('[role="dialog"]') as HTMLElement | null;
    if (!dialog) return null;

    const containingBlockAncestors: string[] = [];
    for (let el = dialog.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (
        cs.transform !== 'none' ||
        cs.translate !== 'none' ||
        cs.filter !== 'none' ||
        cs.perspective !== 'none'
      ) {
        containingBlockAncestors.push(`${el.tagName.toLowerCase()}[class="${el.className}"]`);
      }
    }

    const rect = dialog.getBoundingClientRect();
    return {
      position: getComputedStyle(dialog).position,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      containingBlockAncestors,
    };
  });
}

test.describe('phone: feedback trigger moves into the nav menu (R3, D-09)', () => {
  // Runs ONLY in the `phone` project. Both `journeys` and `phone` glob every
  // e2e/*.spec.ts (playwright.config.ts:44 and :87), so the guard must be
  // explicit in both directions.
  test.skip(({ isMobile }) => !isMobile, 'phone-project block — desktop coverage lives in the describe below');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    // D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:78-86): the
    // config pins colorScheme, but the reused storageState can carry a stored
    // next-themes key that outranks it — assert the theme before any visual
    // assertion so a style failure cannot be misdiagnosed.
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('floating button computes display:none below md (unlayered-.btn regression guard)', async ({ page }) => {
    const fab = fabLocator(page);
    // Vacuity guard: exactly one FAB exists in the DOM (hidden or not).
    await expect(fab, 'scoped FAB locator (icon-only "Send feedback" button) must resolve exactly one element').toHaveCount(1);

    // COMPUTED display, not class tokens: `.btn` is unlayered in globals.css
    // and beats layered utilities, so `hidden` placed on the button itself
    // would be inert while present in the markup. The toggle therefore lives
    // on a bare wrapper div — read the wrapper's computed display (display of
    // a hidden parent does NOT propagate to children's computed value, so the
    // wrapper, not the button, is the element to read).
    const wrapperDisplay = await fab.evaluate((btn) => getComputedStyle(btn.parentElement as HTMLElement).display);
    expect(
      wrapperDisplay,
      'FAB visibility wrapper must compute display:none at phone width — if this fails with the `hidden` class present in the markup, an unlayered declaration (e.g. .btn) is defeating the layered hidden utility',
    ).toBe('none');
  });

  test('nav row opens the layout-root modal: menu closes, dialog resolves against the viewport, category is pathname-derived', async ({ page }) => {
    // Open the hamburger; the Send feedback row appears alongside its siblings.
    const menuButton = page.getByRole('button', { name: 'Toggle menu' });
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    const row = navRowLocator(page);
    await expect(row, 'scoped nav-row locator (visible-text "Send feedback" button) must resolve exactly one element').toHaveCount(1);
    await expect(row).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invites' })).toBeVisible();
    // Theme row's accessible name is its dynamic aria-label, not "Theme".
    await expect(page.getByRole('button', { name: /switch to (light|dark) mode/i })).toBeVisible();

    // Tap the row: ONE transition must close the menu AND open the modal.
    await row.click();
    await expect(modalHeading(page)).toBeVisible();
    // The menu must already be closed by the time the modal is visible — not
    // a separate later step (task 2b's combined transition regression guard).
    // includeHidden: while the Radix modal is open it aria-hides everything
    // outside the dialog (Header included), so the role query must opt into
    // hidden nodes or it resolves 0 and this asserts against nothing — the
    // same accommodation the desktop FAB assertions in this file already make.
    await expect(
      page.getByRole('button', { name: 'Toggle menu', includeHidden: true }),
      'mobile menu must be closed (aria-expanded=false) by the time the modal is visible — the row tap closes the menu in the same transition that opens the modal',
    ).toHaveAttribute('aria-expanded', 'false');

    // Containing-block regression guard (see measureModalSurface's contract):
    // the modal's fixed geometry must resolve against the viewport, never
    // against the nav dropdown's `translate`.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const surface = await measureModalSurface(page);
    expect(surface, 'the modal heading must live inside a [role="dialog"] surface').not.toBeNull();
    expect(
      surface!.position,
      'the dialog surface must be position:fixed — the whole containing-block guard below is vacuous otherwise',
    ).toBe('fixed');
    expect(
      surface!.containingBlockAncestors,
      'no ancestor between the dialog and <body> may carry transform/translate/filter/perspective — any of those becomes the containing block for the fixed dialog and clips it to that ancestor (the nav dropdown is the known offender, RESEARCH Pitfall 1)',
    ).toEqual([]);
    // ±1px for sub-pixel rounding of the -50%/-50% translate.
    expect(
      Math.abs(surface!.centerX - viewport!.width / 2),
      `dialog centre X ${surface!.centerX} must match the ${viewport!.width}px viewport's centre — an offset centre means left:50% resolved against a transformed ancestor, not the viewport`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(surface!.centerY - viewport!.height / 2),
      `dialog centre Y ${surface!.centerY} must match the ${viewport!.height}px viewport's centre — an offset centre means top:50% resolved against a transformed ancestor, not the viewport`,
    ).toBeLessThanOrEqual(1);

    // Category equivalence: /groupHomePage maps to "Groups" in the provider's
    // CATEGORY_MAP (FeedbackModalProvider.tsx). The row entry point must drive
    // the FULL open transition — the pathname-derived category seed, not just
    // isOpen — so the select must show the current page's category, not the
    // default General or a leftover from a previous open.
    const categoryValue = await modalHeading(page).evaluate((heading) => {
      const dialog = (heading as HTMLElement).closest('[role="dialog"]');
      const select = dialog?.querySelector('select');
      return select ? (select as HTMLSelectElement).value : null;
    });
    expect(
      categoryValue,
      'modal category must be "Groups" on /groupHomePage — the provider open() seeds category from the pathname in the same transition as isOpen; "General" here means the row lifted isOpen alone (T-87.8-20)',
    ).toBe('Groups');

    // With the menu closed, the modal stays visible and interactive.
    const textarea = page.getByPlaceholder("Tell us what's on your mind...");
    await textarea.fill('typed from the phone nav row entry point');
    await expect(textarea).toHaveValue('typed from the phone nav row entry point');

    // Focus restoration (T-87.8-22): closing the modal returns focus to the
    // nav row that opened it.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(modalHeading(page)).toHaveCount(0);
    await expect(
      navRowLocator(page, { includeHidden: true }),
      'closing the modal must return keyboard focus to the nav "Send feedback" row that opened it — the provider records the invoking element on open() and restores it on close()',
    ).toBeFocused();
  });
});

test.describe('desktop: FAB present but below every overlay (R3, D-10)', () => {
  // Runs ONLY in the `journeys` project — same both-directions guard as above
  // (playwright.config.ts:44 and :87 glob every spec into both projects).
  test.skip(({ isMobile }) => isMobile, 'desktop-project block — phone coverage lives in the describe above');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:78-86).
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('FAB is visible at desktop width', async ({ page }) => {
    const fab = fabLocator(page);
    await expect(fab, 'scoped FAB locator (icon-only "Send feedback" button) must resolve exactly one element').toHaveCount(1);
    await expect(fab).toBeVisible();
    const wrapperDisplay = await fab.evaluate((btn) => getComputedStyle(btn.parentElement as HTMLElement).display);
    expect(wrapperDisplay, 'FAB visibility wrapper must not compute display:none at desktop width').not.toBe('none');
  });

  test('FAB does not paint above the Footer "Report bug" modal', async ({ page }) => {
    const fab = fabLocator(page);
    await expect(fab).toHaveCount(1);
    await expect(fab).toBeVisible();

    // Open the Footer's own feedback modal (FeedbackForm — the SECOND occlusion
    // instance D-10 fixes; the FAB used to win the z-50 tie against it by DOM
    // order). Since 88-17 that modal is a portalled Radix dialog whose backdrop
    // is z-50, so the FAB's z-30 must still lose.
    await page.getByRole('button', { name: 'Report bug or suggest feature' }).click();
    await expect(page.getByRole('heading', { name: 'Report Bug or Suggest Feature' })).toBeVisible();

    // Behavioural stacking assertion: hit-test at the FAB's centre.
    // elementFromPoint returns the TOPMOST painted element — reading z-index
    // off a class would prove nothing about what actually intercepts a tap.
    const box = await fab.boundingBox();
    expect(box, 'FAB must have a bounding box at desktop width').not.toBeNull();
    const fabIsTopmost = await page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit?.closest('button[aria-label="Send feedback"]');
    }, [box!.x + box!.width / 2, box!.y + box!.height / 2] as const);
    expect(
      fabIsTopmost,
      'elementFromPoint at the FAB centre must NOT resolve to the FAB while the Report-bug modal is open — the FAB (z-30) must sit below the .modal-overlay tier (z-index 50); if this fails the FAB is intercepting taps meant for the overlay (T-87.8-18)',
    ).toBe(false);
  });

  test('closing the feedback modal returns focus to the FAB that opened it', async ({ page }) => {
    const fab = fabLocator(page);
    await expect(fab).toHaveCount(1);
    await fab.click();
    await expect(modalHeading(page)).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(modalHeading(page)).toHaveCount(0);
    await expect(
      fab,
      'closing the modal must return keyboard focus to the FAB that opened it — the provider records the invoking element on open() and restores it on close() (T-87.8-22)',
    ).toBeFocused();
  });
});

// Logged-out coverage (runs in BOTH projects): a real render assertion replacing
// the previous grep-for-auth-guard check. Feedback entry points are
// deliberately auth-only (Footer.js:11-12, T-87.8-16 / ASVS V2) — a logged-out
// visitor must see NEITHER the FAB nor the nav row.
test('logged-out visitor gets neither feedback entry point (fresh context, no storageState)', async ({ browser, baseURL }) => {
  // DECISION Phase 87.8-12: explicit EMPTY storageState over bare newContext().
  // A bare browser.newContext() is NOT cookie-less under @playwright/test — the
  // harness injects every config `use` option the call didn't name, including
  // this project's storageState: '.auth/user.json' (playwright/lib/index.js
  // runBeforeCreateBrowserContext), so the "fresh" context arrived carrying the
  // CI user's appSession and this test observed a LOGGED-IN /about (dispatch-run
  // 30833214370 trace evidence). Removing the empty object is a regression to
  // that bug, not a cleanup.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    // Public, unauthenticated route (Footer's PublicFooter renders here).
    await page.goto(`${baseURL}/about`);
    // Anchor: the FOOTER's exact-"Privacy" link, so absence-assertions below can
    // only run after the auth state resolved and the real footer replaced the
    // isLoading placeholder (Footer.js renders <div h-12/> until useUser settles).
    // DECISION Phase 87.8-12: exact:true over default substring matching — the
    // about-page BODY contains a "Privacy Policy" link (about/page.js:59) that
    // substring-matches 'Privacy' and satisfied this anchor DURING isLoading,
    // letting both zero-counts pass vacuously before the FAB could mount (the
    // pre-arming green was exactly that false pass). exact:true cannot match
    // 'Privacy Policy', so the anchor waits for the footer itself.
    await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toBeVisible();

    // Zero-COUNT assertions on the same scoped locators the logged-in tests
    // prove resolve to exactly one element each — includeHidden so even a
    // rendered-but-hidden entry point fails, and the locator is named in the
    // message so a mistyped selector cannot masquerade as a passing negative.
    await expect(
      fabLocator(page),
      'scoped FAB locator (icon-only button named "Send feedback", includeHidden) must match ZERO elements for a logged-out visitor — the auth guard precedes the variant switch',
    ).toHaveCount(0);
    await expect(
      navRowLocator(page, { includeHidden: true }),
      'scoped nav-row locator (visible-text "Send feedback" button, includeHidden) must match ZERO elements for a logged-out visitor — the Header slot is user-gated',
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
