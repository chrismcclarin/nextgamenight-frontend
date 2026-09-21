import { test, expect, type Locator } from '@playwright/test';

/**
 * Phase 88.6-30 — W53: a native date/time control must fit its cell at 375px.
 *
 * THE DEFECT IS iOS SAFARI'S, AND NOTHING HERE RENDERS IT. The owner reported it on his
 * iPhone: iOS Safari resolves `width: 100%` on a NATIVE date/time control against the
 * CONTENT box and then adds padding and border on top, so the control overruns its cell by
 * a constant ~18px. The `phone` project is chromium-pinned by DECISION Phase 87.7 D-14
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
 * ── WHY THIS SPEC MOVED OFF gameDetail (2026-09-21, and it is NOT a locator fix) ────────
 *
 * The first version of this spec opened `E2E_EVENT_DETAIL_PATH` and looked for the "Show
 * Filters & Sort" toggle. It failed in CI run 35202982040 with "element(s) not found", and
 * the accessible name was never the cause: `E2E_EVENT_DETAIL_PATH` carries `event_id` and
 * `group_id` but NO `game_id`, and `gameDetail/page.js:1588` returns the EVENT-ONLY view
 * early when `game_id` is absent. The Game Sessions card — and therefore that toggle and
 * those two date controls — lives in the GAME view's return at `:2640` and is unreachable
 * on that URL. This is already recorded in the repo: see the `DECISION Phase 88-30
 * (DEF-88-24-05)` marker in `padding-budget.spec.ts`, which hit the identical wall, and
 * which explicitly REJECTED re-pointing `E2E_EVENT_DETAIL_PATH` at a URL carrying a
 * `game_id` — the backend fixture creates its Event with no `game_id` and emits no game
 * key, and that variable is SHARED with `touch-targets.spec.ts`, so changing it would move
 * a green spec's surface too. No locator can resolve an element the route never renders.
 *
 * So the fence runs on `/userProfile`'s availability forms instead, which is a BETTER
 * surface for it on every axis that matters here:
 *   - it needs no new fixture (the route is already loaded by `padding-budget.spec.ts:409`
 *     and `touch-targets.spec.ts:2070` in this same authenticated project);
 *   - it carries SEVEN of the thirteen date/time controls in the app — both a `type="time"`
 *     pair and a `type="date"` pair — against gameDetail's two;
 *   - it is the owner's SECOND reported screen, photographed in the same 2026-09-21 report.
 * The originally-reported gameDetail filter card is covered by the owner's device check and
 * by the compile-time pin in `src/components/ui/Input.test.tsx`. Restoring a CI assertion on
 * it needs a backend fixture that emits a `game_id` — routed to the owner, not taken here.
 *
 * ── WHAT THIS ASSERTS THAT NOTHING ELSE CAN ────────────────────────────────────────────
 *
 * `Input.test.tsx` compiles the real `globals.css` and proves the rule is EMITTED; jsdom
 * performs no layout, so nothing there observes a rendered box. This spec measures the
 * COMPUTED effect in a real engine at the real viewport:
 *
 *   1. THE RULE APPLIES *AND* IS SCOPED — a date control and a time control both compute
 *      `appearance: none`, while the page's `<SelectControl>` does NOT. That pair separates
 *      the three outcomes a looser assertion conflates: applied-and-scoped (pass),
 *      never-applied (fail), applied-UNSCOPED (fail — and unscoped is the blast radius that
 *      would strip the UA dropdown indicator from all 19 `<SelectControl>` sites, which
 *      declare no `background-image` to fall back on).
 *   2. IT FITS ITS CELL — the control's right edge is inside its cell's right edge and its
 *      box is `>= 44px` wide, so a control that "fits" only by collapsing cannot pass.
 *   3. A SCREENSHOT FOR THE RECORD, written to `test.info().outputPath(...)`. The `phone`
 *      project runs AUTHENTICATED (`playwright.config.ts:128`, `storageState:
 *      '.auth/user.json'`), so this is a LOGGED-IN screenshot. `outputPath` lands it under
 *      `test-results/`, which `.gitignore:66` excludes root-anchored. A bare repo-relative
 *      filename beside this spec would NOT be ignored — there is no `*.png` rule — and
 *      would be committable. The structural backstop is a gitignore rule covering PNG files
 *      anywhere under e2e/, named for the owner in `88.6-30-SUMMARY.md`.
 *
 * NOT RUN LOCALLY. The `phone` project depends on the `setup` project, which drives Auth0
 * Universal Login with credentials `playwright.config.ts:22-24` records as deliberately
 * absent locally, and there is no `.auth/user.json` in the tree. Collection and typecheck
 * are the only local proof this file has.
 *
 * IF THE 44px FLOOR CANNOT HOLD, that is a FINDING for the owner's device check — NOT a
 * reason to delete the criterion. Record it; do not relax it.
 */

/** The availability forms live behind the profile's Schedules tab. */
const PROFILE_PATH = '/userProfile';

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

test.describe('W53 — native date/time controls fit their cells at 375px (Phase 88.6-30)', () => {
  // Every new spec joins BOTH projects automatically (`journeys` and `phone` share
  // `testMatch: /.*\.spec\.ts/`). W53 is a phone-tenet defect measured at the phone
  // viewport, so skip the desktop project rather than running 375px assertions at 1280px.
  test.skip(({ isMobile }) => !isMobile, 'W53 is a 375px phone-tenet defect — phone project only');

  test('the date and time controls drop the native appearance, stay inside their cells, and do not drag a <select> with them', async ({
    page,
  }, testInfo) => {
    await page.goto(PROFILE_PATH);

    // The recurring-availability form is collapsed by default
    // (`userProfile/page.js` `showRecurringForm`).
    const addSchedule = page.getByRole('button', { name: /add schedule/i });
    await guardResolved(addSchedule, 'the "+ Add Schedule" toggle on the Schedules tab');
    await addSchedule.click();

    // `id`s come from each field's own label association (`htmlFor="recurring-start-time"`),
    // so these locators cannot drift apart from the visible labels the owner is looking at.
    const startTime = page.locator('#recurring-start-time');
    const startDate = page.locator('#recurring-start-date');
    // THE SCOPING CONTROL. A text `Input` built from the SAME `controlClass`, chosen
    // because it is rendered unconditionally (`userProfile/page.js:2836`, inside the BGG
    // import card, which carries no render guard) — a scoping assertion that can vanish
    // with the fixture is a scoping assertion that silently stops running.
    const textControl = page.locator('#bgg-username');

    await guardResolved(startTime, 'the "Available From (Start Time)" control');
    await guardResolved(startDate, 'the "Start Date" control');
    await guardResolved(textControl, 'the BGG username text control (the scoping control)');

    // ── 1. APPLIED AND SCOPED ────────────────────────────────────────────────
    for (const [name, control] of [
      ['Available From (Start Time)', startTime],
      ['Start Date', startDate],
    ] as const) {
      expect(
        await computed(control, 'appearance'),
        `"${name}" does not compute appearance: none — the globals.css @layer base rule was not emitted, or its selector no longer matches this control. That is exactly the state that shipped W53 to the owner's phone twice: the class reached the DOM and no CSS existed behind it.`,
      ).toBe('none');
    }
    expect(
      await computed(textControl, 'appearance'),
      'a plain text control built from the SAME controlClass also computes appearance: none — the date/time normalisation is UNSCOPED. Unscoped is the blast radius that strips the UA dropdown indicator from all 19 <SelectControl> sites, which declare no background-image to fall back on.',
    ).not.toBe('none');

    // The `<SelectControl>` itself is the site that would actually LOSE something, so check
    // it too — but only when it renders. Its card is gated on the identity row carrying
    // `notification_preferences`, and a hard assertion on a fixture-dependent element turns
    // a seed change into a W53 failure. Present: assert it. Absent: the line above already
    // holds the scoping.
    const select = page.locator('#reminder-window');
    if (await select.count()) {
      expect(
        await computed(select, 'appearance'),
        'the reminder-window <select> computes appearance: none — the normalisation reached a <select>, which is the exact site that renders with NO dropdown indicator when it does',
      ).not.toBe('none');
    }

    // ── 2. FITS ITS CELL ─────────────────────────────────────────────────────
    for (const [name, control] of [
      ['Available From (Start Time)', startTime],
      ['Start Date', startDate],
    ] as const) {
      const cell = control.locator('xpath=..');
      const box = await control.boundingBox();
      const cellBox = await cell.boundingBox();
      expect(box, `"${name}" did not render a box`).not.toBeNull();
      expect(cellBox, `"${name}"'s cell did not render a box`).not.toBeNull();
      if (!box || !cellBox) return;

      expect(
        box.width,
        `"${name}" is ${box.width}px wide inside a ${cellBox.width}px cell — this is W53 itself: the native control is sizing against the content box and adding padding on top`,
      ).toBeLessThanOrEqual(cellBox.width + 0.5);
      expect(
        box.x + box.width,
        `"${name}"'s right edge runs past its cell's right edge — the overflow the owner photographed`,
      ).toBeLessThanOrEqual(cellBox.x + cellBox.width + 0.5);

      // The positive floor: "now fits" must not be satisfiable by a control that
      // collapsed to nothing.
      expect(
        box.width,
        `"${name}" is ${box.width}px wide — under 44px it may fit its cell but fails R4`,
      ).toBeGreaterThanOrEqual(44);
    }

    // ── 3. THE SCREENSHOT FOR THE RECORD ─────────────────────────────────────
    // outputPath() -> test-results/, which `.gitignore:66` excludes root-anchored. A bare
    // repo-relative filename here would be committable, and the phone project is
    // AUTHENTICATED, so it would be a logged-in screenshot in git history.
    await startTime
      .locator('xpath=ancestor::div[contains(@class,"border-line")][1]')
      .screenshot({ path: testInfo.outputPath('availability-dates-375.png') });
  });
});
