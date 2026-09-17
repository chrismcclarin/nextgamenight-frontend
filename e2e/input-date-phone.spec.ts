import { test, expect, type Locator } from '@playwright/test';

/**
 * Phase 88.6-30 — W53: `<Input type="date">` must fit its cell at 375px.
 *
 * THE DEFECT IS iOS SAFARI'S, AND NOTHING HERE RENDERS IT. The owner reported it on his
 * iPhone (light mode, 2026-08-28) on the Game Sessions filter card: the native date control
 * keeps its INTRINSIC width, so `w-full` cannot shrink it and "From Date"/"To Date" run to
 * the card edge. The `phone` project is chromium-pinned by DECISION Phase 87.7 D-14
 * (`playwright.config.ts:121`) and `ci.yml` installs chromium only, so this spec is a
 * REGRESSION FENCE on the shipped fix, not a reproduction of the bug. The reproduction is
 * the owner's device check (plan 88.6-30 task 4). A green run here does not overrule it.
 *
 * Whether this project should have a WebKit lane at all is an OWNER question and is already
 * answered: owner-ruled 2026-09-09, SPIKE-GATED — "Should a WebKit Playwright lane exist?
 * Precondition: a spike proving Linux WebKit reproduces the iOS date-control behaviour;
 * until then this plan's engine-independent pin + owner-iPhone check is the control."
 * Recorded in `.planning/deferred/phase-88.6.md` and in plan 46's ledger as `owner-ruled`.
 * This spec therefore changes NO config: no new project, no browser install, no D-14 edit.
 *
 * WHAT THIS ASSERTS THAT NOTHING ELSE CAN. `Input.test.tsx`'s pins are class-STRING pins
 * plus a Tailwind-compile pin; jsdom performs no layout, so neither observes a rendered
 * box. This spec measures the COMPUTED effect in a real engine at the real viewport:
 *
 *   1. THE RULE IS EMITTED *AND* SCOPED — the date control's computed `min-width` is `0px`
 *      while a sibling NON-date control's is not. That single pair separates the three
 *      outcomes a looser assertion conflates: emitted-and-scoped (pass), never-emitted
 *      (fail), emitted-UNSCOPED (fail — and unscoped is the `appearance-none` blast radius
 *      that would strip the UA indicator from all 19 `<SelectControl>` sites).
 *   2. IT FITS *AND* IS NOT CLIPPED — the box is `<=` its containing cell AND `>= 44px`
 *      wide, and the value string is not clipped. The floor is asserted on the arm that
 *      SHIPPED, not only on the rejected unconditional one: the gated `min-w-0` is exactly
 *      what removes the intrinsic minimum width, so the clip risk lives with the chosen arm.
 *      `e2e/touch-targets.spec.ts` does not stand in for this — it measures named CTA
 *      locators, never an `Input`.
 *   3. A SCREENSHOT FOR THE RECORD, written to `test.info().outputPath(...)`. The `phone`
 *      project runs AUTHENTICATED (`playwright.config.ts:128`, `storageState:
 *      '.auth/user.json'`), so this is a LOGGED-IN screenshot. `outputPath` lands it under
 *      `test-results/`, which `.gitignore:66` excludes root-anchored. A bare repo-relative
 *      filename beside this spec would NOT be ignored — there is no `*.png` rule — and
 *      would be committable. The structural backstop is a gitignore rule covering PNG files anywhere under e2e/,
 *      named for the owner in `88.6-30-SUMMARY.md`.
 *
 * IF THE 44px FLOOR CANNOT HOLD inside the filter grid cell at 375px, that is a FINDING for
 * the owner's device check — NOT a reason to delete the criterion. Record it; do not relax it.
 */

// Same fixture idiom and URL shape as touch-targets.spec.ts and padding-budget.spec.ts —
// deliberately NOT a second variable name for the same path, so a fixture rename moves
// every spec together.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

/** A zero-count locator makes every geometry assertion vacuous — guard it explicitly. */
async function guardResolved(locator: Locator, what: string): Promise<void> {
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — this is a failure of the LOCATOR or the fixture state, not of the W53 work`,
  ).toBeVisible();
}

const computed = (locator: Locator, prop: string) =>
  locator.evaluate(
    (el, p) => window.getComputedStyle(el).getPropertyValue(p),
    prop,
  );

test.describe('W53 — the date Input fits its cell at 375px (Phase 88.6-30)', () => {
  // Every new spec joins BOTH projects automatically (`journeys` and `phone` share
  // `testMatch: /.*\.spec\.ts/`). W53 is a phone-tenet defect measured at the phone
  // viewport, so skip the desktop project rather than running 375px assertions at 1280px.
  test.skip(({ isMobile }) => !isMobile, 'W53 is a 375px phone-tenet defect — phone project only');

  test('date control: min-width is released and SCOPED, the box fits its cell, and the value is not clipped', async ({
    page,
  }, testInfo) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);

    // The filter card is collapsed by default (`gameDetail/page.js` `showFilters`).
    const toggle = page.getByRole('button', { name: /show filters & sort/i });
    await guardResolved(toggle, 'the "Show Filters & Sort" toggle');
    await toggle.click();

    // The reported subject. `id`s come from the panel's own label association
    // (`htmlFor="session-filter-date-from"`), so these locators cannot drift apart from
    // the visible labels the owner will be looking at on his phone.
    const dateFrom = page.locator('#session-filter-date-from');
    const playerWon = page.locator('#session-filter-player-won');
    await guardResolved(dateFrom, 'the "From Date" control');
    await guardResolved(playerWon, 'the "Player Won" control (the sibling NON-date control)');

    // ── 1. EMITTED AND SCOPED ────────────────────────────────────────────────
    expect(
      await computed(dateFrom, 'min-width'),
      'the date control\'s computed min-width is not 0px — either Tailwind emitted no rule for the arbitrary variant, or the variant syntax does not compile on this Tailwind version',
    ).toBe('0px');
    expect(
      await computed(playerWon, 'min-width'),
      'a sibling NON-date control also computes min-width: 0px — the W53 normalisation is UNSCOPED and is reaching the other ~85 control usages, including all 19 <SelectControl> sites',
    ).not.toBe('0px');

    // ── 2. FITS AND IS NOT CLIPPED ───────────────────────────────────────────
    const cell = dateFrom.locator('xpath=..');
    const dateBox = await dateFrom.boundingBox();
    const cellBox = await cell.boundingBox();
    expect(dateBox, 'the date control did not render a box').not.toBeNull();
    expect(cellBox, 'the date control\'s grid cell did not render a box').not.toBeNull();
    if (!dateBox || !cellBox) return;

    expect(
      dateBox.width,
      `the date control is ${dateBox.width}px wide inside a ${cellBox.width}px cell — this is W53 itself: the native control is keeping its intrinsic width`,
    ).toBeLessThanOrEqual(cellBox.width + 0.5);
    expect(
      dateBox.x + dateBox.width,
      'the date control\'s right edge runs past its cell\'s right edge',
    ).toBeLessThanOrEqual(cellBox.x + cellBox.width + 0.5);

    // The positive floor: `min-w-0` removes the intrinsic minimum width, so "now fits"
    // must not be satisfiable by a control that shrank to nothing.
    expect(
      dateBox.width,
      `the date control is ${dateBox.width}px wide — under 44px it may fit its cell but fails R4, and the gated min-w-0 is what removed its intrinsic floor`,
    ).toBeGreaterThanOrEqual(44);

    // Not clipped: the rendered box is wide enough for its own content. `scrollWidth`
    // exceeding `clientWidth` is the engine telling us the value string does not fit.
    const clipped = await dateFrom.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(
      clipped,
      'the date control\'s value string is clipped inside its own box — a clipped-narrow control must not pass as "now fits"',
    ).toBe(false);

    // ── 3. THE SCREENSHOT FOR THE RECORD ─────────────────────────────────────
    // outputPath() -> test-results/, which `.gitignore:66` excludes root-anchored. A bare
    // repo-relative filename here would be committable, and the phone project is
    // AUTHENTICATED, so it would be a logged-in screenshot in git history.
    await page
      .locator('#session-filter-date-from')
      .locator('xpath=ancestor::div[contains(@class,"border-line")][1]')
      .screenshot({ path: testInfo.outputPath('input-date-375.png') });
  });
});
