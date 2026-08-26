import { test, expect, type Locator, type Page } from '@playwright/test';

import {
  assertTheme,
  compositeGround,
  contrastRatio,
  deltaLStar,
  describeDelta,
  describeGround,
  describeRatio,
  focusRingMeasurement,
  forceLightMode,
  groundResolutionOf,
  lStarOfGround,
  probeElement,
  ratioAgainstGround,
  vacuityGround,
  type Measurement,
} from './support/contrast';

/**
 * Phase 88.3 SPEC Req 11 — GATE C, the RENDERED contrast pins.
 *
 * WHAT THIS FILE IS FOR, and why Gate A is not enough. `tokenContrast.test.ts` (Gate A,
 * plan 05) pins the DECLARED value of every token. It is fast, exhaustive and blind to
 * four things that only exist in a browser: a cascade order that makes a utility dead, an
 * inline `style` that outranks the class it was supposed to fork, a COMPOSITED ground
 * (a translucent wash over something else), and a class string Tailwind never emitted
 * because `@source` did not see it. Req 11 asks for measured pins at 375x667 — the width
 * the phone-forward tenet says a value is actually verified at.
 *
 * ---------------------------------------------------------------------------------------
 * THIS SPEC CANNOT BE RUN ON A LAPTOP, BY DESIGN.
 * ---------------------------------------------------------------------------------------
 * `.auth/user.json` is produced by the `setup` project against real Auth0, and the
 * credentials are deliberately absent locally (`playwright.config.ts:24-27`). The local
 * proofs for this file are `npx playwright test --list` (it is collected, and the case
 * count grew by exactly the number of `test(` blocks here) and
 * `npx tsc --noEmit -p tsconfig.e2e.json` (it compiles and the relative helper import
 * resolves). CI is the only place it REPORTS. Do not read a green local command as a green
 * gate.
 *
 * ---------------------------------------------------------------------------------------
 * ASSERTION SHAPE: ratios and delta-L* only. No hex is ever asserted.
 * ---------------------------------------------------------------------------------------
 * The reasoning lives with the helper (`e2e/support/contrast.ts`, DECISION Phase 88.3
 * (Req 11)) so it sits next to the code that computes the numbers. In short: a floor can
 * only fail when the requirement fails; a pinned colour fails whenever anyone changes a
 * colour, including improvements. 87.7 D-12 ruled out screenshot baselines for the same
 * reason, and Req 12's owner phone UAT owns "does it look right".
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THIS SPEC DELIBERATELY DOES NOT ASSERT, and it is not an oversight.
 * ---------------------------------------------------------------------------------------
 * THE 42 `hover:` SITES. Tailwind v4 emits every `hover:` utility inside
 * `@media (hover: hover)`, and the `phone` project (iPhone SE 3rd gen, `isMobile: true`,
 * `hasTouch: true`) reports `matchMedia('(hover: hover)')` as FALSE — all of them are
 * INERT here. A rendered hover pin in this file could therefore never fail. A gate that
 * cannot red is worse than no gate, because it reads as coverage (threat T-88.3-54). The
 * hover sweep's acceptance is Gate A (the declared value) plus Gate B (the class token),
 * which is a token-and-source assertion, not a rendered one. Adding a hover assertion here
 * is a decision, not a cleanup — and it would be the wrong one until this project reports
 * hover as available.
 *
 * ---------------------------------------------------------------------------------------
 * SELECTOR POLICY (`padding-budget.spec.ts:50-51`), and it matters MORE here than anywhere.
 * ---------------------------------------------------------------------------------------
 * Role, label, text and ARIA STATE only — never a Tailwind class. This phase RENAMES class
 * tokens (`text-status-*` -> `text-content-status-*`, `text-accent` ->
 * `text-content-accent`), so a class-based locator would break for a reason that has
 * nothing to do with contrast. The helper READS class strings for the diagnostic
 * breakdown; no locator SELECTS by one. Where structure is unavoidable this file uses an
 * ARIA attribute (`[aria-current="date"]`) or an XPath step over tags/roles — both are
 * semantic, neither is a class or an id.
 */

// Runs ONLY in the `phone` project — the same runtime skip shape as
// `padding-budget.spec.ts:194-200`. Both `journeys` (playwright.config.ts:44) and `phone`
// (playwright.config.ts:96) collect every `e2e/*.spec.ts`, so phone-only scoping is a
// RUNTIME skip, not a collection filter. D-07 pins one project for this gate: the ratios
// are a phone-forward gate and re-measuring them at 1280px would double the runtime to
// re-prove numbers that do not depend on width.
test.skip(
  ({ isMobile }) => !isMobile,
  'SPEC Req 11: the rendered contrast pins are a phone-forward gate (375x667, D-07), so this spec runs only in the phone project'
);

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI. Same
// obviously-fake fallback idiom as `padding-budget.spec.ts:69-76` and
// `touch-targets.spec.ts:60-61`, and DELIBERATELY THE SAME VARIABLE NAMES as those
// siblings, so a fixture rename moves every spec together.
//
// `Group.id` is a UUID string (`models/Group.js:6-9`), not an integer PK, so the literal
// '1' below is an invalid value on purpose: a route guarded by `validateUUID` 400s loudly
// on it rather than silently resolving to some other row. That is the whole point of an
// obviously-fake fallback.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_COLOURED_GROUP_ID = process.env.E2E_COLOURED_GROUP_ID ?? '1';
const E2E_INVITE_GROUP_NAME = process.env.E2E_INVITE_GROUP_NAME ?? 'E2E Invite Group';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

/** SPEC floors, named once so a failure message and the assertion cannot drift apart. */
const AA_TEXT = 4.5;
const NON_TEXT = 3.0; // WCAG 1.4.11 — focus indicators and other non-text contrast
const CARD_BORDER_MIN = 1.4; // UI-SPEC §5.2: a hairline, not a wireframe
const CARD_BORDER_MAX = 1.8;
const PAGE_CARD_DELTA = 4.0; // Req 1, archetype A (ships at 5.00)
const NESTED_DELTA_LIGHT = 1.5;
const NESTED_DELTA_DARK = 3.0;
const TINT_LSTAR_FLOOR = 75; // Req 9, SPEC amended 2026-08-25 to a t = 0.70 tint (was 85)
const CARD_LSTAR_FLOOR = 97; // distinguishes the white card (100) from the warm-100 page (95.02)

/**
 * The fixture group's CARD on the home page, anchored BY NAME.
 *
 * Never "the first card". Plan 02 mints a SECOND fixture group that carries a preset
 * colour, and it renders on this same page as a TINTED card whose border and muted text
 * read different ratios; `routes/groups.js`'s group-list query has no `ORDER BY`, so an
 * unnamed first-card locator is not a stable anchor and would silently measure whichever
 * row Postgres returned first. `padding-budget.spec.ts:209-214` already anchors this same
 * fixture group by name — this reuses that idiom rather than inventing one.
 */
function fixtureCard(page: Page): Locator {
  return page
    .getByRole('heading', { name: E2E_INVITE_GROUP_NAME })
    .locator('xpath=ancestor::div[@role="button"][1]');
}

/**
 * The groupHomePage identity header, and its dim overlay.
 *
 * The header is reached from the `<h1>` (the group name) via its inline `min-height`, and
 * the overlay is the header's FIRST element child — that ordering is the shipped source's,
 * not a guess (`groupHomePage/page.js`: overlay div, then the title row, then the CTA row).
 * The overlay carries no role and no text, so there is no semantic locator for it; an
 * XPath step over structure is the narrowest available handle and is still not a class or
 * an id selector.
 */
function groupHeader(page: Page): Locator {
  return page
    .getByRole('heading', { level: 1 })
    .locator('xpath=ancestor::div[contains(@style,"min-height")][1]');
}
function groupHeaderDim(page: Page): Locator {
  return groupHeader(page).locator('xpath=./*[1]');
}

/** The three header controls Req 9 names, in the order the SPEC lists them. */
function headerControls(page: Page): { label: string; locator: Locator }[] {
  return [
    { label: 'Manage Members', locator: page.getByRole('button', { name: 'Manage Members' }) },
    { label: 'Plan Game Session', locator: page.getByRole('link', { name: 'Plan Game Session' }) },
    { label: 'Add New Game Event', locator: page.getByRole('button', { name: 'Add New Game Event' }) },
  ];
}

/**
 * Vacuity guard, in the `padding-budget.spec.ts:212-214` shape.
 *
 * A one-rung chain, or a chain that never resolved, means the LOCATOR is wrong — the probe
 * landed on `<body>` or a detached node — and every ratio computed from it would be
 * vacuous. This fails on the anchor, loudly, rather than reporting a confident number.
 */
function guardGround(label: string, m: Measurement): void {
  const resolution = groundResolutionOf(m.probe);
  expect(m.probe.levels.length, vacuityGround(label, resolution)).toBeGreaterThanOrEqual(2);
  expect(m.probe.opaqueAt, describeGround(label, resolution)).toBeGreaterThanOrEqual(0);
}

/** Assert one ratio against a floor, with the ground chain in the failure message. */
function expectRatio(label: string, m: Measurement, floor: number): void {
  guardGround(label, m);
  expect(m.ratio, describeRatio(label, floor, m)).toBeGreaterThanOrEqual(floor);
}

/** The four-step journey to the create-event scheduler (`padding-budget.spec.ts:238-241`). */
async function openCreateEvent(page: Page): Promise<void> {
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible({ timeout: 15_000 });
  // Deliberately NOT followed by "Switch to Manual Entry": the scheduler assertions below
  // are VISUAL-mode assertions (Req 5's today tint only exists there). The toggle is
  // exercised later in the light run, and only after those reads.
}

/** The scheduler's today cell in the phone week strip, located by its ARIA state. */
function todayStripCell(page: Page): Locator {
  // `SchedulerWeekStrip.tsx:130` puts `aria-current="date"` on today's tab EXACTLY so that
  // today is exposed to assistive tech rather than by tint alone. That makes it the honest
  // semantic handle here too. Playwright's `getByRole` has no `current` option, so this is
  // an ARIA ATTRIBUTE selector — not a class and not an id.
  return page.locator('[role="tab"][aria-current="date"]');
}

/* =========================================================================================
 * NOTE ON WHICH TODAY SITE THIS SPEC MEASURES (a correction to the plan's citation).
 * =========================================================================================
 * The plan names `EventScheduler.tsx`'s `renderDayHeader` span as Req 5/Req 7's today
 * target. VERIFIED 2026-08-26: that span is rendered by the DESKTOP day header only —
 * `EventScheduler.tsx:1121` gates the week strip on `isPhoneViewport` and the plain-column
 * header on `!isPhoneViewport`, so at 375x667 the desktop day header DOES NOT EXIST. The
 * phone's today site is `SchedulerWeekStrip.tsx:188-198`, the OTHER half of the same paired
 * ternary, and it resolves the SAME `--color-bg-accent-subtle` token because
 * `TODAY_TINT_SCOPE` (`EventScheduler.tsx:274-276`) re-points it for the whole subtree.
 * Same token, same tint, same requirement — the reachable half. Substituting the desktop
 * span here would be an unreachable locator, not a stricter test.
 * ======================================================================================= */

test.describe('Req 11 Gate C — rendered contrast, LIGHT', () => {
  // Pitfall 4: `colorScheme` is ORTHOGONAL to the theme class. `playwright.config.ts:51`
  // and `:113` pin `colorScheme: 'dark'` on both projects and carry a D-11 marker saying
  // removing either half is a decision — this describe does not touch them, it overrides
  // the emulation FOR ITSELF. What that emulation governs is UA form-control chrome and
  // scrollbars (`globals.css` declares no `color-scheme` of its own, so the UA default
  // governs); it does NOT set `<html class>`. The class comes from the localStorage write
  // below. Both mechanisms are needed and neither implies the other.
  test.use({ colorScheme: 'light' });

  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
  });

  test('home: page/card separation, resting shadow, hairline border, muted text and two focus rings', async ({ page }) => {
    await page.goto('/');
    await assertTheme(page, 'light');

    const card = fixtureCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await test.step('surface 1 — Req 1: the card sits a real step above the page', async () => {
      const cardProbe = await probeElement(card, []);
      const cardGround = compositeGround(cardProbe);
      const bodyProbe = await probeElement(page.locator('body'), []);
      const pageGround = compositeGround(bodyProbe);
      expect(cardGround, describeGround('home card', groundResolutionOf(cardProbe))).not.toBeNull();
      expect(pageGround, describeGround('home page', groundResolutionOf(bodyProbe))).not.toBeNull();

      const delta = deltaLStar(cardGround, pageGround);
      expect(delta, `home: delta-L* did not compute from card=${cardGround} page=${pageGround}`).not.toBeNull();
      expect(
        delta as number,
        describeDelta('home — card vs page (Req 1)', PAGE_CARD_DELTA, String(cardGround), String(pageGround), delta as number)
      ).toBeGreaterThanOrEqual(PAGE_CARD_DELTA);
    });

    await test.step('surface 2 — Req 3: a resting card carries NO shadow', async () => {
      // A PROPERTY assertion, not a value assertion, so it sits comfortably inside the
      // `tailwind-v4-styles.spec.ts:37-40` policy. `hover:shadow-theme-md` is inert on this
      // project (see the hover note at the top), so what is measured here IS the rest state.
      const probe = await probeElement(card, ['box-shadow']);
      expect(
        probe.computed['box-shadow'].raw.trim(),
        'home card (Req 3): archetype A puts the depth in the PAGE, so the resting shadow is gone. A shadow here means --shadow-sm stopped being `none`.'
      ).toBe('none');
    });

    await test.step('surface 3 — Req 2: the card border is a hairline, not a wireframe', async () => {
      // `border-top-color`, NOT the shorthand: this card also carries `border-l-4
      // border-l-accent`, so the LEFT border is the accent rule and reads a different
      // ratio by design. Measuring the shorthand would average two deliberate values.
      const m = await ratioAgainstGround(card, 'home card border (Req 2)', 'border-top-color');
      guardGround('home card border (Req 2)', m);
      expect(m.ratio, describeRatio('home card border (Req 2) — lower bound', CARD_BORDER_MIN, m)).toBeGreaterThanOrEqual(CARD_BORDER_MIN);
      expect(m.ratio, describeRatio('home card border (Req 2) — upper bound', CARD_BORDER_MAX, m)).toBeLessThanOrEqual(CARD_BORDER_MAX);
    });

    await test.step('surface 1 — Req 8: muted text on BOTH of its named grounds', async () => {
      // Req 8 names two grounds and they are asserted SEPARATELY, never collapsed: a token
      // can clear one and fail the other, which is exactly what warm-500 did before this
      // phase (4.11 on white, 3.63 on warm-100).
      //
      // CARD ground: the "Last Game:" row's date span inside the fixture card. It renders
      // unconditionally — `formatDate(undefined)` returns the string 'Never'
      // (`src/lib/datetime.ts:194`), so the element is never empty and never invisible.
      const lastGameRow = card.getByText('Last Game:', { exact: true }).locator('xpath=ancestor::div[1]');
      const mutedOnCard = lastGameRow.locator('xpath=./span[last()]');
      await expect(mutedOnCard).toBeVisible({ timeout: 15_000 });
      const onCard = await ratioAgainstGround(mutedOnCard, 'muted text on a CARD (Req 8)');
      expectRatio('muted text on a CARD (Req 8)', onCard, AA_TEXT);

      // PAGE ground: the footer's copyright line. `Footer.js:122` puts
      // `text-content-muted` on the row and `Footer.js:81` puts `bg-surface-page` on the
      // <footer>, so this element's ground chain terminates on the page surface.
      // Scoped to the <span> for the same parent-text reason as surface 12 below: the row div
      // wraps the logo plus this span, and a bare text locator can match both.
      const mutedOnPage = page.locator('span').filter({ hasText: /^©\s*\d{4}\s+Next Game Night$/ });
      await expect(mutedOnPage).toBeVisible({ timeout: 15_000 });
      const onPage = await ratioAgainstGround(mutedOnPage, 'muted text on the PAGE (Req 8)');
      expectRatio('muted text on the PAGE (Req 8)', onPage, AA_TEXT);

      // The chain breakdown is what proves the two elements resolved to DIFFERENT grounds.
      // Without this, both assertions could be measuring the same surface twice and Req 8
      // would be half-tested while reading as fully tested.
      expect(
        onCard.ground,
        `Req 8: the card-ground and page-ground muted probes resolved to the SAME ground ` +
          `(${onCard.ground}). One of the two anchors is wrong, so only one ground is ` +
          `actually being tested.\n${describeGround('muted on card', onCard.resolution)}\n` +
          describeGround('muted on page', onPage.resolution)
      ).not.toBe(onPage.ground);
    });

    await test.step('surface 1 — Req 7: the Button primitive and a card-hosted control', async () => {
      // Req 7 target 1 of 4 — the `Button` primitive. `UserHomePage.js:245` renders the
      // phone-only Calendar entry point through it (`md:hidden`, so it exists ONLY at this
      // width). Located by role and name; the Icon inside is decorative.
      const button = page.getByRole('button', { name: 'Calendar' });
      await expect(button).toBeVisible({ timeout: 15_000 });
      const buttonRing = await focusRingMeasurement(page, button, 'Button primitive focus ring (Req 7)');
      expectRatio('Button primitive focus ring (Req 7)', buttonRing, NON_TEXT);

      // Req 7 target 2 of 4 — the WHITE CARD ground.
      //
      // DEVIATION FROM THE PLAN, recorded here rather than silently: the plan asks for a
      // "Card-hosted LINK" on this surface. VERIFIED 2026-08-26 — at 375px the home page
      // renders no `role=link` inside a card: `EventCalendar` and `UpcomingEventsCard` are
      // both behind `hidden md:flex` (`UserHomePage.js:273`), `PhoneEventBar` and
      // `UpcomingEventsCard`'s rows are `<button>`s, and the only links on the page are the
      // header nav and the footer, neither of which is card-hosted. The group card ITSELF
      // is `role="button"` (`grouplist.js:303`) and its ground IS the white card, so it
      // covers Req 7's card GROUND, which is what SPEC:179-182 actually enumerates (page,
      // card, today tint, primary button). The LINK component type is covered on
      // groupHomePage ("Plan Game Session") and in the header menu (surface 10).
      const cardRing = await focusRingMeasurement(page, card, 'card-hosted control focus ring (Req 7)');
      expectRatio('card-hosted control focus ring (Req 7)', cardRing, NON_TEXT);
    });
  });

  test('about: three named migrated accent sites on the page ground (Req 4)', async ({ page }) => {
    await page.goto('/about');
    await assertTheme(page, 'light');

    // Req 4's acceptance names ">= 3 named migrated sites on light card AND light page".
    // These three are the page half; the card half is asserted on groupHomePage below.
    // `/about`'s container declares no background, so the chain terminates on
    // `body { background-color: var(--color-bg-page) }` (globals.css:1379-1382).
    const sites: { label: string; locator: Locator }[] = [
      // Located by "the link whose accessible name is an address" rather than by spelling
      // the address into a test file. `about/page.js:45-50`.
      { label: 'about — contact mailto (about/page.js:45)', locator: page.getByRole('link', { name: /@/ }) },
      { label: 'about — Privacy Policy (about/page.js:59)', locator: page.getByRole('link', { name: 'Privacy Policy' }) },
      { label: 'about — Terms of Service (about/page.js:63)', locator: page.getByRole('link', { name: 'Terms of Service' }) },
    ];
    for (const site of sites) {
      await expect(site.locator).toBeVisible({ timeout: 15_000 });
      const m = await ratioAgainstGround(site.locator, site.label);
      expectRatio(site.label, m, AA_TEXT);
    }
  });

  test('create-event scheduler: today tint, its ring, an Input ring, and a nested block', async ({ page }) => {
    await openCreateEvent(page);
    await assertTheme(page, 'light');

    const todayCell = todayStripCell(page);
    await expect(
      todayCell,
      'Req 5: no strip cell carries aria-current="date". Either the strip did not mount ' +
        '(isPhoneViewport starts false and is corrected in an effect) or the visible week ' +
        'does not contain today. This is a LOCATOR failure, not a contrast failure.'
    ).toBeVisible({ timeout: 15_000 });

    await test.step('surface 4 — Req 5: the today number reads against its own tint', async () => {
      // `SchedulerWeekStrip.tsx:191-198` hangs a `data-testid` on this span expressly so a
      // gate can find it (the T-88.1-39 pin already uses it). It is `aria-hidden` — the
      // cell's `aria-label` carries the full name — so a role/text locator cannot reach it,
      // and a test id is neither a class nor an id selector.
      const dayNumber = todayCell.getByTestId('strip-day-number');
      const m = await ratioAgainstGround(dayNumber, 'today number on the today tint (Req 5)');
      expectRatio('today number on the today tint (Req 5)', m, AA_TEXT);
    });

    await test.step('surface 4 — Req 7: the today cell tint vs the ring colour', async () => {
      // Req 7 target 3 of 4 — the TODAY TINT ground. This one is NOT reached by Tab and
      // must not be: the strip's roving focus starts on the first column
      // (`useHeatmapCell`), so tabbing lands on whichever day that is, not on today, and
      // would silently measure the wrong cell's ground. So the tint and the ring colour are
      // read DIRECTLY off the today cell: `--ring` is the property the emitted ring utility
      // resolves (plan 07 proved `--color-focus-ring` is inert because `--ring` resolves on
      // `:root`), and the tint is the cell's own composited background.
      const tintZone = todayCell.locator('xpath=./span[1]');
      const probe = await probeElement(tintZone, ['--ring']);
      const tint = compositeGround(probe);
      expect(tint, describeGround('today tint', groundResolutionOf(probe))).not.toBeNull();
      const ring = probe.computed['--ring'];
      expect(
        ring.css,
        `Req 7: the today cell's --ring did not normalise to a colour. Raw: ${JSON.stringify(ring.raw)}.`
      ).not.toBeNull();

      const m: Measurement = {
        ratio: 0,
        fg: ring.css as string,
        ground: tint as string,
        probe,
        resolution: groundResolutionOf(probe),
      };
      const ratio = contrastRatio(m.fg, m.ground);
      expect(ratio, `Req 7: could not compute the today ring ratio from ${m.fg} on ${m.ground}`).not.toBeNull();
      m.ratio = ratio as number;
      expectRatio('focus ring vs the today tint (Req 7)', m, NON_TEXT);
    });

    await test.step('surface 5 — Req 1: a nested block is distinct from its parent card', async () => {
      // The scheduler's "no slot selected yet" prompt (`EventScheduler.tsx:1215-1228`)
      // is a `bg-surface-page` block INSIDE the modal's `bg-card` body. It renders
      // unconditionally until a slot is picked, which is the state this test is in.
      //
      // DEVIATION FROM THE PLAN, recorded rather than silently substituted: the plan names
      // `ManageMembers.js:410` or `userProfile/page.js:1839`. VERIFIED 2026-08-26 — the
      // first is gated on `!canManageMembers` and the fixture user OWNS this group, and the
      // second is gated on `userData?.sms_enabled`, a DB-only admin entitlement the fixture
      // does not set. Both would be zero-element locators. This block is the same
      // requirement (a sunken/recessed block inside a card) at a site that actually renders.
      const nested = page
        .locator('p')
        .filter({ hasText: /Tap and hold on a day to pick a time\.|Click and drag on the calendar/ });
      await expect(nested).toBeVisible({ timeout: 15_000 });
      const nestedProbe = await probeElement(nested, []);
      const nestedGround = compositeGround(nestedProbe);

      // The parent card's ground, read from the modal title — its chain skips the nested
      // block entirely and terminates on the modal's own surface.
      const cardProbe = await probeElement(page.getByRole('heading', { name: /create event/i }), []);
      const parentGround = compositeGround(cardProbe);

      expect(nestedGround, describeGround('nested block', groundResolutionOf(nestedProbe))).not.toBeNull();
      expect(parentGround, describeGround('parent card', groundResolutionOf(cardProbe))).not.toBeNull();
      const delta = deltaLStar(nestedGround, parentGround);
      expect(delta, `nested block: delta-L* did not compute from ${nestedGround} / ${parentGround}`).not.toBeNull();
      expect(
        delta as number,
        describeDelta('nested block vs its card (Req 1, light)', NESTED_DELTA_LIGHT, String(nestedGround), String(parentGround), delta as number)
      ).toBeGreaterThanOrEqual(NESTED_DELTA_LIGHT);
    });

    await test.step('surface 4 — Req 7: the Input primitive', async () => {
      // Req 7 target 4 of 4 — the `Input` primitive.
      //
      // DEVIATION FROM THE PLAN, recorded: the plan asks for an `Input` reached in VISUAL
      // mode and offers `createEvent.js:1229` (`rsvp_deadline`) as a candidate "if it sits
      // outside the useVisualCalendar ternary". VERIFIED 2026-08-26 — it does sit outside
      // the ternary, but it is gated on `newEvent.start_date &&
      // new Date(newEvent.start_date) > new Date()`, and in visual mode no start date has
      // been chosen yet, so it does not render. There is NO `Input` primitive rendered in
      // visual mode on this form: `GameComboInput` is its own component and Comments is a
      // `Textarea`. The plan's own escape hatch is taken — the toggle is exercised HERE,
      // after every visual-mode read above, exactly as the plan permits. The ring is a
      // property of the primitive (`Input.tsx:79-80`), not of the mode.
      await page.getByRole('button', { name: /switch to manual entry/i }).click();
      const input = page.getByLabel(/start date & time/i);
      await expect(input).toBeVisible({ timeout: 15_000 });
      const m = await focusRingMeasurement(page, input, 'Input primitive focus ring (Req 7)');
      expectRatio('Input primitive focus ring (Req 7)', m, NON_TEXT);
    });
  });

  test('groupHomePage (UNSET group): header controls, title, ring — and a card-ground accent site', async ({ page }) => {
    // The param is `id`, not `groupId` (`padding-budget.spec.ts:214`).
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertTheme(page, 'light');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    await test.step('surface 7 — Req 9(i): three controls and the title', async () => {
      for (const control of headerControls(page)) {
        await expect(control.locator).toBeVisible({ timeout: 15_000 });
        const m = await ratioAgainstGround(control.locator, `unset header — ${control.label} (Req 9i)`);
        expectRatio(`unset header — ${control.label} (Req 9i)`, m, AA_TEXT);
      }
      const title = await ratioAgainstGround(page.getByRole('heading', { level: 1 }), 'unset header — title (Req 9i)');
      expectRatio('unset header — title (Req 9i)', title, AA_TEXT);

      // NO BORDER ASSERTION HERE, deliberately (plan review 2026-08-25, DEC-7). The three
      // controls are `.btn`, and the unlayered `.btn { border: none }` (globals.css:1079)
      // makes every border utility on them DEAD. A computed `border-*-color` read stays
      // populated even with `border-style: none`, so a border ratio here would be a number
      // about a border nobody paints — vacuous, and it would read as coverage. The
      // header-CTA border claim is owned by Phase 88.6, not by this gate.
    });

    await test.step('surface 7 — Req 7: a header control focus ring against the header ground', async () => {
      const m = await focusRingMeasurement(page, headerControls(page)[0].locator, 'unset header — control focus ring (Req 7)');
      expectRatio('unset header — control focus ring (Req 7)', m, NON_TEXT);
    });

    await test.step('surface 6 — Req 4: a migrated accent site on a light CARD', async () => {
      // The card half of Req 4's acceptance. `ManageMembers.js:490` renders "(You)" beside
      // the viewer's own row, unconditionally for the signed-in member, inside the shared
      // Modal whose content surface is `bg-card` (`Modal.tsx:186`).
      await page.getByRole('button', { name: 'Manage Members' }).click();
      const you = page.getByText('(You)', { exact: true });
      await expect(you).toBeVisible({ timeout: 15_000 });
      const m = await ratioAgainstGround(you, 'accent on a light CARD (Req 4)');
      expectRatio('accent on a light CARD (Req 4)', m, AA_TEXT);

      // Prove the ground really is the CARD and not the page: the white card is L* 100 and
      // the warm-100 page is L* 95.02, so a 97 floor separates them without pinning either.
      const lightness = await lStarOfGround(you, 'accent on a light CARD (Req 4)');
      expect(
        lightness.value,
        `Req 4 (card half): the accent site resolved to a ground at L* ${lightness.value.toFixed(2)} ` +
          `(${lightness.ground}). Below ${CARD_LSTAR_FLOOR} means the walk terminated on the PAGE, not a ` +
          `card — so the card half of Req 4's acceptance would be untested while reading as tested.`
      ).toBeGreaterThanOrEqual(CARD_LSTAR_FLOOR);
    });
  });

  test('groupHomePage (NAVY group): tinted header ground, its controls, and the dim overlay', async ({ page }) => {
    // The UNSET header's ground is read FIRST, from its own page load, because the vacuity
    // guard below needs both grounds and reading them in this order costs two navigations
    // instead of three.
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertTheme(page, 'light');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    const unset = await lStarOfGround(page.getByRole('heading', { level: 1 }), 'unset header ground');

    await page.goto(`/groupHomePage?id=${E2E_COLOURED_GROUP_ID}`);
    await assertTheme(page, 'light');
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toBeVisible({ timeout: 15_000 });

    await test.step('surface 8 — Req 9(ii): the tint is real, not a silently-uncoloured group', async () => {
      // THE VACUITY GUARD FOR THIS WHOLE TEST (threat T-88.3-53). If the fixture regressed
      // to an uncoloured group, every assertion below would PASS while proving nothing —
      // it would be measuring the unset header a second time. The `jq -e` guard in ci.yml
      // is the other half: it stops a missing key becoming the string "null". Neither layer
      // alone closes the hole.
      const coloured = await lStarOfGround(title, 'Navy header ground (Req 9ii)');
      expect(
        coloured.ground,
        `Req 9(ii) VACUITY GUARD: the coloured group's header ground (${coloured.ground}) is IDENTICAL ` +
          `to the unset group's (${unset.ground}). The E2E_COLOURED_GROUP_ID fixture is not carrying a ` +
          `colour, so every Req 9(ii) assertion in this test would pass while testing the unset header ` +
          `twice. Fix the fixture, not the floor.`
      ).not.toBe(unset.ground);

      // Req 9's `L* >= 75` floor (SPEC amended 2026-08-25 to a t = 0.70 tint; was 85), read
      // as the DECLARED ground. See `lStarOfGround`'s own note: an ancestor walk cannot see
      // the dim, because the dim is a sibling-order CHILD of the header. The overlay is
      // asserted separately below — that assertion, not this one, is what proves the dim
      // does not wash the tint out.
      expect(
        coloured.value,
        `Req 9(ii): the Navy header's DECLARED ground measured L* ${coloured.value.toFixed(2)} ` +
          `(${coloured.ground}) against a floor of ${TINT_LSTAR_FLOOR}. This is the t = 0.70 tint, not a ` +
          `rendered pixel — the dim overlay is asserted separately in this same test.`
      ).toBeGreaterThanOrEqual(TINT_LSTAR_FLOOR);
    });

    await test.step('surface 8 — Req 9(ii): the dim overlay is transparent in LIGHT', async () => {
      const probe = await probeElement(groupHeaderDim(page), ['background-color']);
      const dim = probe.computed['background-color'];
      expect(
        dim.alpha,
        `Req 9(ii) / UI-SPEC §5.10.3: the header dim measured alpha ${dim.alpha} in LIGHT (raw ` +
          `${JSON.stringify(dim.raw)}). Plan 11 makes it transparent in light on purpose — a 15% black ` +
          `dim over the t = 0.70 tint costs ~11.5 L*, which would drag the RENDERED ground below Req 9's ` +
          `own floor. THIS assertion, not the L* read above, is what proves the dim is not washing the ` +
          `tint out.`
      ).toBe(0);

      // NOT PROBED HERE, and said plainly rather than implied: §5.10.3's OTHER half — the
      // 0.4-alpha dim over a BACKGROUND IMAGE, which applies in both themes — has no
      // fixture. `scripts/e2e-fixtures.js` mints a colour-only coloured group and no group
      // with `background_image_url`, so there is no rendered site to measure. That half's
      // acceptance is the source scan plus the Req 12 owner phone UAT.
    });

    await test.step('surface 8 — Req 9(ii): controls, title and one focus ring on the tint', async () => {
      for (const control of headerControls(page)) {
        await expect(control.locator).toBeVisible({ timeout: 15_000 });
        const m = await ratioAgainstGround(control.locator, `Navy header — ${control.label} (Req 9ii)`);
        expectRatio(`Navy header — ${control.label} (Req 9ii)`, m, AA_TEXT);
      }
      const titleRatio = await ratioAgainstGround(title, 'Navy header — title (Req 9ii)');
      expectRatio('Navy header — title (Req 9ii)', titleRatio, AA_TEXT);

      const ring = await focusRingMeasurement(page, headerControls(page)[0].locator, 'Navy header — control focus ring (Req 7)');
      expectRatio('Navy header — control focus ring (Req 7)', ring, NON_TEXT);
    });
  });

  test('header chrome: the mobile menu ring is amber, not the light purple ring (§5.8.2)', async ({ page }) => {
    await page.goto('/');
    await assertTheme(page, 'light');

    // surface 10. The menu is OPENED FIRST, and that is load-bearing rather than tidy:
    // computed styles ignore opacity and visibility, so tabbing into a still-closed panel
    // would measure a ring nobody can see and PASS vacuously. Plan 07 also put `inert` on
    // the closed panel, so a row inside it is not even focusable until the menu opens —
    // these two pre-assertions are what prove the open actually happened.
    const trigger = page.getByRole('button', { name: 'Toggle menu' });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const row = page.getByRole('link', { name: 'Friends' });
    await expect(
      row,
      '§5.8.2: the mobile menu row is not visible after clicking the toggle. Measuring a ring ' +
        'inside a closed panel would pass vacuously — this pre-assertion exists to stop that.'
    ).toBeVisible({ timeout: 15_000 });

    await test.step('surface 10 — Req 7: the menu trigger', async () => {
      const m = await focusRingMeasurement(page, trigger, 'header menu trigger ring on dark chrome (§5.8.2)');
      expectRatio('header menu trigger ring on dark chrome (§5.8.2)', m, NON_TEXT);
    });

    await test.step('surface 10 — Req 7: an open mobile-menu row', async () => {
      // This is the RENDERED proof that plan 07's `[--ring:var(--amber-400)]` subtree
      // override works. Without it, plan 07's fix is unverified: the light ring is
      // purple-700, and `bg-surface-header` is near-black in BOTH themes, so the global
      // light ring would read ~1.4:1 here.
      const m = await focusRingMeasurement(page, row, 'mobile menu row ring on dark chrome (§5.8.2)');
      expectRatio('mobile menu row ring on dark chrome (§5.8.2)', m, NON_TEXT);
    });
  });

  test('event detail: the status token actually landed on the RSVP count (Req 6)', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertTheme(page, 'light');
    await assertStatusTextLanded(page, 'light');
  });
});

test.describe('Req 11 Gate C — rendered contrast, DARK', () => {
  // No init script here, deliberately. The seven existing `toHaveClass(/dark/)` sites run
  // green in CI against the baked `.auth/user.json` storageState exactly as-is (D-07 says
  // do not touch them), so this describe reproduces that proven path rather than adding a
  // second mechanism that could diverge from it. Contexts are per-test, so the light
  // describe's init script cannot leak here.

  test('home: a resting card carries no shadow in dark either (Req 3)', async ({ page }) => {
    await page.goto('/');
    await assertTheme(page, 'dark');
    const card = fixtureCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const probe = await probeElement(card, ['box-shadow']);
    expect(
      probe.computed['box-shadow'].raw.trim(),
      'home card (Req 3, dark): `--shadow-sm` is `none` in BOTH themes (globals.css:882 and :1146).'
    ).toBe('none');
  });

  test('create-event scheduler: the today number and the nested block hold in dark', async ({ page }) => {
    await openCreateEvent(page);
    await assertTheme(page, 'dark');

    const todayCell = todayStripCell(page);
    await expect(todayCell).toBeVisible({ timeout: 15_000 });
    const m = await ratioAgainstGround(todayCell.getByTestId('strip-day-number'), 'today number on the today tint (Req 5, dark)');
    expectRatio('today number on the today tint (Req 5, dark)', m, AA_TEXT);

    const nested = page
        .locator('p')
        .filter({ hasText: /Tap and hold on a day to pick a time\.|Click and drag on the calendar/ });
    await expect(nested).toBeVisible({ timeout: 15_000 });
    const nestedProbe = await probeElement(nested, []);
    const nestedGround = compositeGround(nestedProbe);
    const cardProbe = await probeElement(page.getByRole('heading', { name: /create event/i }), []);
    const parentGround = compositeGround(cardProbe);
    const delta = deltaLStar(nestedGround, parentGround);
    expect(delta, `nested block (dark): delta-L* did not compute from ${nestedGround} / ${parentGround}`).not.toBeNull();
    expect(
      delta as number,
      describeDelta('nested block vs its card (Req 1, dark)', NESTED_DELTA_DARK, String(nestedGround), String(parentGround), delta as number)
    ).toBeGreaterThanOrEqual(NESTED_DELTA_DARK);
  });

  test('groupHomePage (UNSET group) in dark: the !ground null branch and no dim', async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await assertTheme(page, 'dark');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    for (const control of headerControls(page)) {
      await expect(control.locator).toBeVisible({ timeout: 15_000 });
      const m = await ratioAgainstGround(control.locator, `unset header dark — ${control.label} (Req 9)`);
      expectRatio(`unset header dark — ${control.label} (Req 9)`, m, AA_TEXT);

      // THE NULL BRANCH. Plan 11's controls fork on
      // `darkArm = !ground || isDarkBackground(ground)`, and the `!ground` clause is the
      // half a colour-value check cannot see: `getBrightness(null)` returns 255 by
      // contract, so a bare `isDarkBackground(ground)` would send the UNCOLOURED header —
      // the app's default and most common case — to the LIGHT arm even in dark theme,
      // where it sits on a purple-800 surface. White text here is that branch firing. The
      // same clause covers a legacy non-hex colour that fails to parse to a tint.
      expect(
        m.fg,
        `Req 9 (dark, unset): "${control.label}" computed its text as ${m.fg}, not white. That is ` +
          `plan 11's \`!ground\` null branch failing — the uncoloured header would be on the LIGHT ` +
          `arm in dark theme. A colour-value-only check cannot see this.`
      ).toBe('rgb(255, 255, 255)');
    }

    const titleRatio = await ratioAgainstGround(page.getByRole('heading', { level: 1 }), 'unset header dark — title (Req 9)');
    expectRatio('unset header dark — title (Req 9)', titleRatio, AA_TEXT);

    const dim = (await probeElement(groupHeaderDim(page), ['background-color'])).computed['background-color'];
    expect(
      dim.alpha,
      `Req 9 (dark, unset): the header dim measured alpha ${dim.alpha} (raw ${JSON.stringify(dim.raw)}). ` +
        `With no group colour there is nothing to protect contrast against, so a wash here would only ` +
        `muddy the themed surface (D-28).`
    ).toBe(0);
  });

  test('groupHomePage (NAVY group) in dark: rendered-equivalent controls and the 15% dim', async ({ page }) => {
    await page.goto(`/groupHomePage?id=${E2E_COLOURED_GROUP_ID}`);
    await assertTheme(page, 'dark');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    for (const control of headerControls(page)) {
      await expect(control.locator).toBeVisible({ timeout: 15_000 });
      const m = await ratioAgainstGround(control.locator, `Navy header dark — ${control.label} (Req 9)`);
      expectRatio(`Navy header dark — ${control.label} (Req 9)`, m, AA_TEXT);
    }
    const titleRatio = await ratioAgainstGround(page.getByRole('heading', { level: 1 }), 'Navy header dark — title (Req 9)');
    expectRatio('Navy header dark — title (Req 9)', titleRatio, AA_TEXT);

    // Plan 11's dark dim, and the reason it is `dark:bg-[rgb(0_0_0/0.15)]` rather than the
    // `dark:bg-black/15` shorthand: the slash form on a theme colour compiles to
    // `color-mix(in oklab, ...)`, which Chromium serialises as `color(srgb ...)`/`oklab(...)`.
    // The probe normalises either through a canvas round-trip, so this assertion holds for
    // whichever form ships — but the bracketed value is what the shipped code chose.
    const dim = (await probeElement(groupHeaderDim(page), ['background-color'])).computed['background-color'];
    expect(
      dim.alpha,
      `Req 9 (dark, Navy): the header dim measured alpha ${dim.alpha} (raw ${JSON.stringify(dim.raw)}), ` +
        `expected ~0.15. This is the DARK-mode dim, distinct from the light-mode alpha-0 assertion.`
    ).toBeGreaterThan(0.1);
    expect(dim.alpha as number).toBeLessThan(0.2);
  });

  test('event detail: the status token actually landed on the RSVP count (Req 6, dark)', async ({ page }) => {
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await assertTheme(page, 'dark');
    await assertStatusTextLanded(page, 'dark');
  });
});

/**
 * Req 6, surface 12 — the RSVP "N Yes" count, in whichever theme the caller set up.
 *
 * WHY THIS SITE AND NOT ANOTHER. `RsvpSection.js:260` renders
 * `<span className="text-content-status-success font-medium">{summary.yes} Yes</span>`
 * (the class name is post-plan-09-rename from `text-status-success`) whenever the event has
 * at least one 'yes' RSVP, and `scripts/e2e-fixtures.js:203-205` seeds TWO on the fixture
 * event reachable at `E2E_EVENT_DETAIL_PATH`. So it is steady-state reachable without
 * triggering an error or a success side effect first.
 *
 * TWO OTHER CANDIDATES WERE CHECKED AND REJECTED, named so nobody reaches for them later:
 *   - `GroupSettings.js:539` (`{leaveError}`) renders only AFTER an error occurs — not
 *     steady state, so a gate on it would need to provoke a failure to observe a colour;
 *   - `ManageMembers.js:400` carries `btn btn-secondary text-content-status-error`, and
 *     `.btn-secondary { color }` (globals.css:1124-1127) is UNLAYERED, so it wins the
 *     cascade over the utility. The class is DEAD there — a ratio measured on it would be
 *     measuring `.btn-secondary`'s colour and reporting it as the status token's.
 *
 * WHY THE RATIO ALONE IS NOT ENOUGH (threat T-88.3-59). This phase renames 134 status
 * sites. The named failure mode is a class that emits NO RULE AT ALL — a typo, or a token
 * `@source` never saw — in which case the element simply INHERITS body colour. Body colour
 * on a card clears 4.5 comfortably, so a ratio-only check would go green while proving the
 * rename did nothing. The colour-INEQUALITY half is what catches it: if the utility landed,
 * this span's computed colour differs from an adjacent plain body-text element's.
 *
 * There is deliberately NO "if no qualifying site exists" exit here. The site is named and
 * confirmed rendered; the assertion is required to exist.
 */
async function assertStatusTextLanded(page: Page, theme: 'light' | 'dark'): Promise<void> {
  // A SPAN, not `getByText`. When the fixture's only responses are 'yes' (which is exactly what
  // `e2e-fixtures.js:203-205` seeds), the count banner's parent <div> has the SAME text content as
  // the span — `getByText` would match both and violate strict mode, and picking the first would
  // silently measure the DIV, whose colour is inherited body text. That is the very failure this
  // assertion exists to catch, so measuring it by accident would be the worst possible outcome.
  const yesCount = page.locator('span').filter({ hasText: /^\d+\s+Yes$/ });
  await expect(
    yesCount,
    `Req 6 (${theme}): the RSVP "N Yes" count is not present at E2E_EVENT_DETAIL_PATH. The fixture ` +
      `seeds two 'yes' RSVPs on this event, so a missing element is a FIXTURE or ROUTE failure, not a ` +
      `contrast failure.`
  ).toBeVisible({ timeout: 15_000 });

  const m = await ratioAgainstGround(yesCount, `RSVP success count (Req 6, ${theme})`);
  expectRatio(`RSVP success count (Req 6, ${theme})`, m, AA_TEXT);

  // The adjacent plain body-text element: the section's own heading, on the same surface.
  const bodyText = page.getByRole('heading', { name: /^(RSVP|Who came)/ });
  await expect(bodyText).toBeVisible({ timeout: 15_000 });
  const bodyProbe = await probeElement(bodyText, ['color']);
  const bodyColor = bodyProbe.computed['color'].css;
  expect(bodyColor, `Req 6 (${theme}): the adjacent body-text colour did not normalise.`).not.toBeNull();

  expect(
    m.fg,
    `Req 6 (${theme}): the status span's computed colour (${m.fg}) is IDENTICAL to adjacent body text ` +
      `(${bodyColor}). It cleared ${AA_TEXT}:1 by INHERITING body colour, which means the ` +
      `text-content-status-success utility emitted no rule. The ratio passing here proves nothing — ` +
      `this is the assertion that catches the 134-site rename shipping a dead class.`
  ).not.toBe(bodyColor);
}

/**
 * Surface 11 — UI-SPEC §11 OI-7, the composited ring ground on the landing hero.
 *
 * ITS OWN SESSION, and that is not optional. `LandingPage.js:31` renders ONLY when the user
 * is logged OUT: `page.js:108-110` gates the whole component behind `!user`, and every
 * other test in this file runs inside the logged-in `storageState` baked from
 * `.auth/user.json`. Overriding `storageState` to an empty one is the only way to reach it.
 *
 * This is also the one Req 7 ground that cannot be computed from tokens: the button's own
 * background is `bg-white/20` over the hero's `bg-surface-nav`, so the ring's ground is a
 * COMPOSITE. `compositeGround` blends it; Gate A cannot, because no token holds that value.
 */
test.describe('Req 11 Gate C — OI-7, the logged-out landing hero (LIGHT)', () => {
  test.use({ colorScheme: 'light', storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
  });

  test('the Google sign-in button ring clears 3:1 against its composited ground', async ({ page }) => {
    await page.goto('/');
    await assertTheme(page, 'light');

    const google = page.getByRole('link', { name: 'Sign in with Google' });
    await expect(
      google,
      'OI-7: the logged-out Google sign-in link is not on the page. If this fails, the storageState ' +
        'override did not take and the session is still logged IN — LandingPage renders only when !user.'
    ).toBeVisible({ timeout: 15_000 });

    const m = await focusRingMeasurement(page, google, 'OI-7 — Google sign-in ring on the hero (Req 7)');
    expectRatio('OI-7 — Google sign-in ring on the hero (Req 7)', m, NON_TEXT);
  });
});
