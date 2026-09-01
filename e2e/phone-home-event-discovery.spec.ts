import { test, expect, type Locator, type Page } from '@playwright/test';
// Plan 88.1-19 MEASUREMENT instruments — read-only attachments, no assertions, and NOT a
// spec file so Playwright cannot collect it as a suite. See `e2e/support/diagnostics.ts`.
import { attachDiagnostics, probeFooterOcclusion } from './support/diagnostics';
// The SHIPPED theme mechanism, both halves. `forceLightMode` writes the next-themes
// localStorage key through an init script; `assertTheme` proves the class landed before any
// style- or layout-dependent claim is made. Imported rather than re-invented: a second theme
// mechanism in this file could drift from `contrast.spec.ts`'s and neither would be wrong.
import { assertTheme, forceLightMode } from './support/contrast';

/**
 * Phase 88.1 plan 10 — SPEC Req 11/12 (phone event discovery on the logged-in home page),
 * gated at 375x667.
 *
 * AMENDED Phase 88.5 plan 10 (SPEC Req 1, 2, 3, 5). The phone bottom event bar this file was
 * built around was DELETED in plan 88.5-07, and the calendar sheet gained a hero card plus
 * Happening-now / This-week / Later sub-sections in plan 88.5-08. Four consequences, each
 * deliberate:
 *
 *   1. RETIRED — the Req 11a spec ("the bottom bar replaces the desktop column and opens its
 *      sheet in one tap") and the bar half of the desktop-width negative. The surface no
 *      longer exists, so both measured nothing. Nothing replaces them: there is no second
 *      phone event-discovery surface any more, by design.
 *   2. INVERTED, NOT DELETED — the occlusion pin. It used to ask "does THE BAR cover
 *      /Privacy"; it now asks "does ANY fixed element cover /Privacy at 375px". `/Privacy`
 *      (capital P) is load-bearing for Google auth (CLAUDE.md) and this test is the only
 *      guard that link has ever had, so deleting it alongside the specific element that used
 *      to threaten it would have retired the guarantee together with its guard. Restoring a
 *      bar-shaped assertion here is a decision, not a cleanup: the general form is the point.
 *   3. ADDED — the counted Calendar button and the sheet's "Next game night" hero, in BOTH
 *      themes (UI-SPEC section 12 item 14). Both are render-and-geometry claims jsdom cannot
 *      make: a pill that must be VISIBLE inside a button that must STILL measure 44x44 with
 *      it, and a hero that must sit ABOVE the first list row.
 *   4. RE-POINTED — every "event row heading" locator. Plan 88.5-08 demotes the This-week and
 *      Later rows to `<h6>` titles under `<h5>` day headers (`CalendarListView.js:617-618`),
 *      so the old `level: 5` locator now resolves DAY HEADERS as well as row titles and would
 *      have measured a 14px date string in the readable-game-text case. Rows are located by
 *      STRUCTURE instead — a heading inside a row `role="button"` — which is level-agnostic
 *      and cannot drift with the outline again.
 *
 * WHY THIS FILE IS THE GATE AND THE VITEST PINS ARE NOT: `UserHomePage.phone.test.tsx` and
 * `UserHomePage.calendarSheet.test.tsx` pin every branch jsdom can see — count integrity,
 * suppression, error-before-empty, mount counts, dismiss paths. They cannot see LAYOUT,
 * because jsdom has none. Everything measured here is therefore a thing no unit test can
 * assert: the 44x44 touch floor, the readable game text, the below-`md` / at-`md` split, the
 * hero's position relative to the list, and above all the FOOTER OCCLUSION check — `Footer`
 * is a SIBLING of `<main>` (`layout.js:86-91`), so a `fixed` element can cover the `/Privacy`
 * link with no DOM change at all. Plan 88.1-08 verified that only structurally and handed the
 * real gate here.
 *
 * `/Privacy` (capital P) is load-bearing for Google auth (CLAUDE.md) — this spec asserts
 * REACHABILITY, and must never be "fixed" by lowercasing the path it looks for.
 *
 * WHAT IS PINNED
 *   1. the Calendar button renders below `md`, measures >= 44x44 WITH the count pill inside
 *      it, shows that pill, carries the count in its accessible name, and opens the sheet
 *   2. the sheet LEADS WITH THE HERO — the "Next game night" eyebrow precedes the first list
 *      row in the DOM and sits above it on screen — and both hero RSVP controls are visible
 *      and hit-testable
 *   3. the sheet's "This week" subheader carries a pill whose digits equal the button's count
 *   4. 1-3 are asserted in BOTH themes (UI-SPEC section 12 item 14)
 *   5. the calendar sheet's rows show READABLE game text — 16px, unclipped
 *   6. tapping an event navigates AND leaves no sheet behind (the close-before-navigate
 *      ordering, observed from outside — React batches both into one commit, so this is
 *      the only layer that can observe the outcome at all)
 *   6b. (Req 12, plan 88.1-17) the calendar sheet opens on the UPCOMING section with the
 *      past collapsed: the disclosure is present, reports itself collapsed, controls a
 *      hidden region and meets the 44px floor; expanding it flips aria-expanded and
 *      strictly increases the row count. That last delta is the non-vacuity guard — a
 *      seeded account with no history would otherwise make the case measure nothing.
 *   7. NO fixed element occludes the Footer's /Privacy link
 *   8. at DESKTOP width the Calendar button does not render and the desktop column does
 *
 * PROJECT SPLIT — stated explicitly, as the plan requires. Rows 1-7 run in the `phone`
 * project only; row 8 runs in the desktop `journeys` project only, at its real 1280px
 * width. Both projects match every spec (`playwright.config.ts:65`, `:117`), so each
 * describe carries the opposite skip rather than resizing a viewport by hand: an
 * emulated resize inside the phone project would keep `isMobile`/`hasTouch` set and
 * measure a viewport the app is never actually served at.
 *
 * SELECTOR POLICY: role/label/text only, never Tailwind classes (invite.spec.ts:18).
 * Geometry is read from `boundingBox()` / computed style — the layer where it is real.
 *
 * Fixtures follow the env-const idiom. Nothing new is minted here: this spec drives the
 * logged-in home page through the shared `storageState`, so it needs no id at all beyond
 * the existing seeded account. e2e is CI-only by design (`playwright.config.ts:22-24`) —
 * author locally, verify in CI.
 */

/**
 * Scroll to the true bottom of the page, AFTER the page has stopped growing, and prove the
 * scroll landed before anything is measured.
 *
 * WHY (plan 88.1-19 measured it, run 32774690333). The failing attempt read
 * `documentScrollHeight = 667`, `maxScrollTop = 0`, `scrollTop = 0` at BOTH samples: the page
 * had not grown yet, so the one-shot `window.scrollTo(0, document.body.scrollHeight)` was a
 * no-op against a page with nothing to scroll. Content landed a moment later and the test's own
 * read then saw the `/Privacy` link at 702.1875px against an occluder top of 612px. The passing
 * retry had the content already present at `goto` (`documentScrollHeight = 826`,
 * `maxScrollTop = 159`) and read 543.188 after scrolling. 543.188 + 159 = 702.188 — the
 * arithmetic closes exactly on the recorded failure number, so this is a scroll race and
 * nothing else.
 *
 * What it is NOT: a spacer bug or an auth-branch bug. The bottom-bar clearance spacer was
 * present at its full height, and `authFooterPresent: true` with `loadingPlaceholderLikely:
 * false`, in ALL FOUR samples including the failing one. `88.1-REVIEW.md` IN-01's
 * loading-branch theory is refuted by measurement; the Footer contract hole it names is real
 * but is a different thing, closed separately in `Footer.js`. (Both the bar and its spacer are
 * gone as of plan 88.5-07 — this paragraph is the RECORD of the 88.1-19 measurement, kept so
 * the race below is not "simplified" away by someone who reads the retry as flakiness.)
 *
 * Deliberately NOT a `waitForTimeout`: a fixed sleep would re-introduce the same race on a
 * slower runner. The two gates are "the document stopped changing height" and "the scroll
 * actually landed at maxScrollTop", both observable.
 */
async function scrollToSettledBottom(page: Page): Promise<{ scrollTop: number; maxScrollTop: number }> {
  let previousHeight: number | null = null;
  await expect
    .poll(
      async () => {
        const height = await page.evaluate(
          () => (document.scrollingElement ?? document.documentElement).scrollHeight,
        );
        const stable = previousHeight !== null && height === previousHeight;
        previousHeight = height;
        return stable;
      },
      {
        message:
          "the page never stopped growing, so there is no settled bottom to scroll to — measuring the Footer here would compare geometry against content that is still arriving (the exact plan-19 failure mode)",
        timeout: 15_000,
        intervals: [100, 100, 200, 200, 500],
      },
    )
    .toBe(true);

  const landed = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = maxScrollTop;
    return { scrollTop: el.scrollTop, maxScrollTop };
  });

  expect(
    Math.abs(landed.scrollTop - landed.maxScrollTop),
    `the scroll did not reach the bottom (scrollTop ${landed.scrollTop} vs maxScrollTop ${landed.maxScrollTop}). Every geometry assertion below would then be measuring a link that is still below the fold, which is how a 702px reading appeared in a 667px viewport.`,
  ).toBeLessThanOrEqual(1);

  return landed;
}

/** Vacuity guard (touch-targets.spec.ts:66 / availability-grid-touch.spec.ts:64): a
 *  zero-count locator makes every assertion after it vacuous — that is a failure of the
 *  LOCATOR or the fixture state, not of the work under test. Fail loudly at the locator.
 *  `toBeVisible` FIRST because it auto-waits; `count()` does not, and sampling it against
 *  an unsettled page is what made five of these guards flake on the first armed CI run. */
async function guardResolved(locator: Locator, what: string, atLeast = 1): Promise<void> {
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a zero-count locator makes every assertion after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the Req 11 work`,
  ).toBeVisible();
  const count = await locator.count();
  expect(
    count,
    `locator for ${what} resolved ${count} elements (expected >= ${atLeast}) — a zero-count locator makes every assertion after it vacuous; this is a failure of the LOCATOR or the fixture state, not of the Req 11 work`,
  ).toBeGreaterThanOrEqual(atLeast);
}

/** R4 geometry: BOTH dimensions >= 44. Height-only would pass a narrow control —
 *  `min-h-11` sets no min-width, which is exactly why the button carries `min-w-11` too. */
async function assertMin44(locator: Locator, label: string): Promise<void> {
  const box = await locator.first().boundingBox();
  expect(box, `${label}: boundingBox() returned null — element not rendered`).not.toBeNull();
  if (!box) return;
  expect(
    box.height,
    `${label} height ${box.height}px < 44px — the floor comes from the per-call-site min-h-11 on the Calendar button, not from any global .btn rule`,
  ).toBeGreaterThanOrEqual(44);
  expect(
    box.width,
    `${label} width ${box.width}px < 44px — min-h-11 sets NO min-width, so a narrow control fails the floor at full height; the paired min-w-11 is the mechanism`,
  ).toBeGreaterThanOrEqual(44);
}

/** D-11 dark-theme pre-assertion (touch-targets.spec.ts:133): a computed-style read in
 *  light mode would be meaningless and its failure misdiagnosed. Delegates to the shared
 *  `assertTheme` so this file and `contrast.spec.ts` cannot disagree about what "dark" is. */
async function assertDarkTheme(page: Page): Promise<void> {
  await assertTheme(page, 'dark');
}

/** Phase 88.5: end-anchored name regex relaxed to `/^calendar\b/i` — the accessible
 *  name gains a count ("Calendar, {n} upcoming games this week", UI-SPEC 6.1.5, plan
 *  88.5-07). Prefix + word boundary, not a bare substring. Do NOT apply the same
 *  relaxation to `calendarSheet` on the next line: that targets the DIALOG, whose
 *  name stays exactly "Calendar". */
const calendarButton = (page: Page) => page.getByRole('button', { name: /^calendar\b/i });
const calendarSheet = (page: Page) => page.getByRole('dialog', { name: 'Calendar' });
/** The desktop right column's own heading (`UpcomingEventsCard.js:140`). It stays in the
 *  DOM below `md` — the column is `hidden md:flex` — so this is a VISIBILITY assertion,
 *  never a presence one. */
const desktopColumnHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Upcoming Events', exact: true });

/**
 * The calendar sheet's event-row headings, in DOM order.
 *
 * RE-POINTED Phase 88.5 plan 10, and the change is structural rather than cosmetic. This was
 * `getByRole('heading', { level: 5 })`. Plan 88.5-08's sub-sections demote the This-week and
 * Later groups to `headingLevel="h5"` (the DAY header) / `rowHeadingLevel="h6"` (the ROW
 * title), so `level: 5` now resolves a MIXTURE of day headers and happening-now row titles —
 * and `.first()` of that mixture is usually a 14px date string, which is what the
 * readable-game-text case below would have measured against its 16px floor.
 *
 * A row is therefore identified by STRUCTURE: `EventRow` renders its title heading INSIDE a
 * `role="button"` row (`CalendarListView.js:1046-1055`), and nothing else in this sheet puts a
 * heading inside a button — not the hero (spans only, deliberately, see its own marker), not
 * the past disclosure, not the sub-section `<h4>`s. Level-agnostic by construction, so the
 * next outline change cannot silently re-break it. Going back to a hard-coded level is a
 * decision, not a cleanup.
 */
const sheetRowHeadings = (page: Page) =>
  calendarSheet(page).getByRole('button').getByRole('heading');

/** Req 12: the past disclosure. The COUNT is part of its accessible name by
 *  requirement, so the locator asserts the shape while staying data-agnostic. */
const pastDisclosure = (page: Page) =>
  calendarSheet(page).getByRole('button', { name: /^past events \(\d+\)$/i });

/**
 * The hero's eyebrow (SPEC Req 3). The DOM string is "Next game night"; `uppercase`
 * (UI-SPEC 6.3.1) is what renders it as NEXT GAME NIGHT — the form the ruled mockup shows.
 * BOTH are asserted below: this locator pins the DOM string, and a computed
 * `text-transform` read pins the presentation, because a case-insensitive text match alone
 * would pass just as happily on a lowercase rendering.
 */
const heroEyebrow = (page: Page) =>
  calendarSheet(page).getByText('Next game night', { exact: true });

/** The hero's two RSVP controls, by their ruled first-person copy
 *  (`NextGameNightCard.tsx` `HERO_BUTTON_TEXT`). */
const heroRsvpButtons = (page: Page) => [
  { label: "I'm in", locator: calendarSheet(page).getByRole('button', { name: "I'm in", exact: true }) },
  { label: "Can't make it", locator: calendarSheet(page).getByRole('button', { name: "Can't make it", exact: true }) },
];

/** Named in every fixture-dependent failure message. A seeded account with no event history
 *  makes the Req 12 expand case vacuous, and a seeded account with no event inside 7 days
 *  makes the count pill vacuous — both are FIXTURE failures, never a pass.
 *  `seed-sample-data.js` seeds the past rows (7 of them, -1 to -14 days);
 *  `e2e-fixtures.js` seeds events at +3 and +4 days (`:119`, `:349`) and owns the invariant
 *  that the e2e account still sees them. */
const FIXTURE_OWNER =
  'periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js (past rows come from seed-sample-data.js; the +3d/+4d upcoming rows come from e2e-fixtures.js:119 and :349)';

/** UI-SPEC 6.1.5, both arms. The capture group is the count the pill must show. */
const COUNTED_CALENDAR_LABEL = /^Calendar, (\d+) upcoming games? this week$/;

/**
 * Read the count out of the Calendar button's accessible name, asserting the SHAPE of that
 * name on the way past.
 *
 * The pill is `aria-hidden` (`UpcomingCountPill.tsx:122`), so this label is the ONLY carrier
 * of the number for assistive tech — reading the number FROM it is therefore also the
 * assertion that the number reaches assistive tech at all. A bare "Calendar" means the count
 * is SUPPRESSED (`count === null`: identity or events fetch pending/errored), which on a
 * seeded account is a fixture or backend failure, never a pass.
 */
async function readCalendarCount(page: Page): Promise<number> {
  const label = (await calendarButton(page).first().getAttribute('aria-label')) ?? '';
  const match = COUNTED_CALENDAR_LABEL.exec(label);
  expect(
    match,
    `the Calendar button's accessible name is "${label}" — SPEC Req 2 / UI-SPEC 6.1.5 requires "Calendar, {n} upcoming game(s) this week". A bare "Calendar" means the count is SUPPRESSED (pending or errored fetch), and since the pill is aria-hidden that name is the only place the number exists for assistive tech. On the seeded account this is a FIXTURE or backend failure owned by ${FIXTURE_OWNER}, not a pass.`,
  ).not.toBeNull();
  const count = Number(match?.[1] ?? 0);
  expect(
    count,
    `the Calendar button announces ${count} upcoming games this week, so the pill renders NOTHING (UpcomingCountPill returns null for 0 as well as for null) and every pill assertion below would be vacuous. The seeded account must have at least one event inside 7 days — FIXTURE failure owned by ${FIXTURE_OWNER}.`,
  ).toBeGreaterThanOrEqual(1);
  return count;
}

/**
 * SPEC Req 2, at 375px: the pill is VISIBLE inside the Calendar button, the button still
 * clears 44x44 WITH it, and the count reaches assistive tech through the button's name.
 *
 * Run in both themes — the pill FORKS by theme (amber-700/white in light, amber-500/warm-900
 * in dark, `UpcomingCountPill.tsx:126-128`), so a single-theme pass would leave one of the two
 * shipped arms unrendered by any gate.
 */
async function assertCountedCalendarButton(page: Page): Promise<number> {
  const button = calendarButton(page);
  await guardResolved(button, 'the phone Calendar button (SPEC Req 2 entry point)');

  const count = await readCalendarCount(page);

  // The pill itself. Located by its TEXT — the digits — scoped inside the button, which
  // keeps this inside the file's role/label/text selector policy and needs no test id.
  const pill = button.getByText(String(count), { exact: true });
  await expect(
    pill,
    `the Calendar button announces ${count} upcoming games this week but renders no visible "${count}" — the amber count pill is missing or hidden at 375px. It is the whole of SPEC Req 2's visible half; the aria-label passing on its own is exactly the failure this assertion exists to separate out.`,
  ).toBeVisible();

  // 44x44 WITH the pill inside. The pill adds width, never height (h-5 inside a min-h-11
  // button), so this is the assertion that the pill did not push the control off its floor
  // in some future layout change.
  await assertMin44(button, 'the phone Calendar button (with the count pill inside it)');

  return count;
}

/**
 * SPEC Req 3, at 375px: the sheet LEADS with the hero.
 *
 * "Leads" is two separate claims and both are asserted, because either alone can be true
 * while the surface is wrong: DOM ORDER (the eyebrow precedes the first row) and GEOMETRY
 * (the eyebrow is above it on screen). A hero rendered after the list but absolutely
 * positioned over it would pass the second and fail the first; a hero rendered first but
 * pushed below the fold would pass the first and fail the second.
 *
 * Both are read in ONE evaluate. The sheet settles asynchronously (the hero's own RSVP read
 * lands after mount), and a coordinate that crosses an await boundary on this surface has
 * gone stale before — the same lesson `touch-targets.spec.ts:580-590` records for D-13.
 */
async function assertHeroLeadsTheSheet(page: Page, count: number): Promise<void> {
  await guardResolved(heroEyebrow(page), 'the hero\'s "Next game night" eyebrow (SPEC Req 3)');
  await guardResolved(
    sheetRowHeadings(page),
    `an event row heading inside the calendar sheet — without a row there is nothing for the hero to lead, and the seeded account must have upcoming events (FIXTURE failure owned by ${FIXTURE_OWNER})`,
  );

  const order = await calendarSheet(page).evaluate((dialog) => {
    const eyebrow = Array.from(dialog.querySelectorAll<HTMLElement>('span, p, h1, h2, h3, h4, h5, h6')).find(
      (el) => (el.textContent ?? '').trim() === 'Next game night',
    );
    const rowHeading = dialog.querySelector<HTMLElement>(
      '[role="button"] h1, [role="button"] h2, [role="button"] h3, [role="button"] h4, [role="button"] h5, [role="button"] h6',
    );
    if (!eyebrow || !rowHeading) {
      return { found: false, precedes: false, eyebrowTop: 0, rowTop: 0, transform: '', rowText: '' };
    }
    const eyebrowRect = eyebrow.getBoundingClientRect();
    const rowRect = rowHeading.getBoundingClientRect();
    return {
      found: true,
      // DOCUMENT_POSITION_FOLLOWING (4) = the row comes AFTER the eyebrow in the DOM.
      precedes: Boolean(eyebrow.compareDocumentPosition(rowHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
      eyebrowTop: Math.round(eyebrowRect.top * 1000) / 1000,
      rowTop: Math.round(rowRect.top * 1000) / 1000,
      transform: getComputedStyle(eyebrow).textTransform,
      rowText: (rowHeading.textContent ?? '').trim().slice(0, 40),
    };
  });

  expect(
    order.found,
    'the hero eyebrow and the first row heading could not both be resolved inside the sheet — the probe cannot be constructed, so fix the probe, not the layout',
  ).toBe(true);
  expect(
    order.precedes,
    `the "Next game night" eyebrow does not precede the first event row ("${order.rowText}") in the DOM — SPEC Req 3 puts the hero ABOVE the list as a sibling, and reading order is what a screen reader and a keyboard user get. Absolute positioning that only LOOKS right is exactly what this half rules out.`,
  ).toBe(true);
  expect(
    order.eyebrowTop,
    `the "Next game night" eyebrow renders at y=${order.eyebrowTop} and the first event row ("${order.rowText}") at y=${order.rowTop} — the hero is not visually leading the sheet at 375px.`,
  ).toBeLessThan(order.rowTop);
  expect(
    order.transform,
    `the hero eyebrow's computed text-transform is "${order.transform}" — the ruled hero leads with NEXT GAME NIGHT in caps (UI-SPEC 6.3.1). The DOM string is deliberately sentence-case "Next game night", so a case-insensitive text match would pass on a lowercase rendering; this is the half that would not.`,
  ).toBe('uppercase');

  // SPEC Req 4: both RSVP controls are present AND actually receive a pointer. `trial: true`
  // runs Playwright's whole actionability pipeline — visible, stable, hit target reached —
  // and then does NOT click, so no RSVP is written by this probe.
  for (const { label, locator } of heroRsvpButtons(page)) {
    await expect(
      locator,
      `the hero's "${label}" control is not visible in the sheet at 375px — SPEC Req 4 puts both RSVP answers on the hero.`,
    ).toBeVisible();
    await locator.click({ trial: true, timeout: 5000 });
  }

  // SPEC Req 2, the sheet twin: the "This week" subheader carries the SAME number as the
  // button. One selector value feeds both (`selectUpcomingWithin7Days`), so a disagreement
  // here means two definitions of "this week" have appeared.
  // Prefix match, not anchored: the subheader's accessible name carries an sr-only
  // count clause (", N upcoming this week" — ML15/ML0, 2026-09-01) whenever the pill
  // renders, and this probe only runs when count >= 1, so `/^this week$/` could NEVER
  // match here. Mirrors the jsdom suite's subSection() helper.
  const thisWeek = calendarSheet(page).getByRole('heading', { name: /^this week\b/i });
  await guardResolved(
    thisWeek,
    `the sheet's "This week" subheader — the button announces ${count} upcoming games this week, so the section those events belong to must render (locator, FIXTURE or partition failure; fixture owned by ${FIXTURE_OWNER})`,
  );
  await expect(
    thisWeek.getByText(String(count), { exact: true }),
    `the "This week" subheader does not carry a "${count}" pill while the Calendar button announces ${count} — the twin pills are fed by ONE count from ONE selector call, so a mismatch means a second definition of "this week" has appeared somewhere between the button and the sheet.`,
  ).toBeVisible();
}

test.describe('Phase 88.1 Req 11/12 + Phase 88.5 Req 2/3 — phone event discovery, DARK (phone project)', () => {
  // Inverse of tailwind-v4-styles.spec.ts:57 and the same shape as
  // touch-targets.spec.ts:214 — these are phone-tenet requirements measured at 375x667.
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet requirements — phone project only');

  test('SPEC Req 2: the Calendar button shows the count pill, still meets 44x44, and opens the sheet', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    await assertCountedCalendarButton(page);

    await calendarButton(page).click();
    await expect(calendarSheet(page)).toBeVisible();
  });

  test('SPEC Req 3: the sheet leads with the NEXT GAME NIGHT hero and a counted This week subheader', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const count = await assertCountedCalendarButton(page);
    await calendarButton(page).click();
    await expect(calendarSheet(page)).toBeVisible();

    await assertHeroLeadsTheSheet(page, count);
  });

  test('11b: a calendar row shows readable, unclipped game text at 16px', async ({ page }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    await guardResolved(calendarButton(page), 'the phone Calendar button');
    await calendarButton(page).click();
    const sheet = calendarSheet(page);
    await expect(sheet).toBeVisible();

    // THE ROW HEADING IS THE GAME TEXT. `CalendarListView` falls back to
    // `event.Game.name` for a row's heading whenever the event carries no explicit
    // title, and then suppresses the separate game-name line because the two would be
    // identical. Every event this app seeds is that shape, so asserting only on the
    // separate line would resolve zero elements and vacuously "pass".
    //
    // See `sheetRowHeadings` for why this is a heading-INSIDE-A-ROW-BUTTON locator rather
    // than the `level: 5` one it replaced: after plan 88.5-08 the first level-5 heading in
    // this sheet is usually a 14px DAY header, which would fail the 16px floor below for
    // entirely the wrong reason.
    const rowHeading = sheetRowHeadings(page).first();
    await guardResolved(rowHeading, 'an event row heading inside the calendar sheet');
    await rowHeading.scrollIntoViewIfNeeded();

    const text = ((await rowHeading.textContent()) ?? '').trim();
    expect(
      text.length,
      `the calendar row heading rendered "${text}" — Req 11b exists because the month grid clips game names to 3-5 characters at ~49px per cell; a phone rendering that shows no more than that fails the same criterion`,
    ).toBeGreaterThan(3);

    // 16px is the UI-SPEC floor for primary content, and the game name IS primary
    // content on this surface.
    const fontSizePx = await rowHeading.evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize),
    );
    expect(
      fontSizePx,
      `the calendar row heading renders at ${fontSizePx}px — the phone arm must render primary content at >= 16px, not the desktop caption scale`,
    ).toBeGreaterThanOrEqual(16);

    // NOT CLIPPED, measured rather than assumed: an overflowing box is exactly what a
    // single-line `truncate` produces at 375px, and it is the failure mode the sheet
    // arm's line-clamp exists to avoid. Sub-pixel layout means an exact <= would flake,
    // hence the 1px tolerance.
    const overflow = await rowHeading.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(
      overflow.scrollWidth,
      `"${text}" overflows its box horizontally (${overflow.scrollWidth} > ${overflow.clientWidth}) — it is being ellipsised, which is the clipping Req 11b rules out`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(
      overflow.scrollHeight,
      `"${text}" overflows its box vertically (${overflow.scrollHeight} > ${overflow.clientHeight}) — the line clamp is cutting the name off`,
    ).toBeLessThanOrEqual(overflow.clientHeight + 1);
  });

  test('Req 12: the calendar sheet opens on upcoming events with no past row visible', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    await guardResolved(calendarButton(page), 'the phone Calendar button');
    await calendarButton(page).click();
    await expect(calendarSheet(page)).toBeVisible();

    // The sheet has CONTENT before anything is asserted about its shape — otherwise an
    // empty sheet would satisfy "no past row is visible" trivially.
    await guardResolved(
      sheetRowHeadings(page),
      'an event row heading inside the calendar sheet (Req 12 opens on the upcoming section)',
    );

    const disclosure = pastDisclosure(page);
    await guardResolved(
      disclosure,
      `the "Past events (N)" disclosure — either Req 12's disclosure is not rendering, or the seeded account has NO past events, which is a FIXTURE failure owned by ${FIXTURE_OWNER}`,
    );

    // Collapsed on open. This IS the requirement: the owner opened this sheet to see
    // "when is the next one" and got ~50 rows of history first.
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // The controlled region resolves and is hidden — the two halves of the disclosure
    // contract. A dangling `aria-controls` announces a region that does not exist.
    const panelId = await disclosure.getAttribute('aria-controls');
    expect(
      panelId,
      'the Past events disclosure carries no aria-controls — the region it expands is unidentifiable to assistive tech',
    ).toBeTruthy();
    // Attribute selector, not `#id`: React's `useId` values contain colons, which are
    // not valid in a bare CSS id selector.
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(
      panel,
      'the region named by aria-controls is visible while the disclosure reports itself collapsed',
    ).toBeHidden();

    // 44px floor. Only this layer can measure it, and the floor is a phone-tenet
    // requirement, not a nice-to-have — the control is full-width, so height is the
    // dimension actually at risk.
    await assertMin44(disclosure, 'the Past events disclosure');
  });

  test('Req 12: expanding Past events reveals rows and reports itself expanded', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    await guardResolved(calendarButton(page), 'the phone Calendar button');
    await calendarButton(page).click();
    await expect(calendarSheet(page)).toBeVisible();

    await guardResolved(sheetRowHeadings(page), 'the calendar sheet event rows');
    const disclosure = pastDisclosure(page);
    await guardResolved(
      disclosure,
      `the "Past events (N)" disclosure — a seeded account with no past events makes this case vacuous; that is a FIXTURE failure owned by ${FIXTURE_OWNER}`,
    );

    const rowsBefore = await sheetRowHeadings(page).count();
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // NON-VACUITY GUARD (mandatory, plan 88.1-17 / T-88.1-46): "the click did not throw"
    // is not an assertion. The row count must strictly INCREASE, because the only thing
    // expanding can do is mount past rows that were not mounted before.
    await expect
      .poll(() => sheetRowHeadings(page).count(), {
        message: `expanding "Past events" did not increase the row count (${rowsBefore} before) — either the disclosure mounts nothing, or the seeded account has zero past events. The latter is a FIXTURE failure owned by ${FIXTURE_OWNER}, never a pass: a zero-delta count means this case measured nothing at all.`,
        timeout: 5_000,
      })
      .toBeGreaterThan(rowsBefore);
  });

  test('11b: tapping an event navigates and leaves no sheet behind', async ({ page }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    await guardResolved(calendarButton(page), 'the phone Calendar button');
    await calendarButton(page).click();
    const sheet = calendarSheet(page);
    await expect(sheet).toBeVisible();

    // Rows are the clickable elements that CONTAIN a row heading — the sheet's other
    // buttons are the close control, the past disclosure and the hero's own controls,
    // none of which contains a heading. Level-agnostic for the same reason
    // `sheetRowHeadings` is: plan 88.5-08 demoted the This-week rows to `<h6>`.
    const rows = sheet.getByRole('button').filter({ has: page.getByRole('heading') });
    await guardResolved(rows, 'clickable event rows inside the calendar sheet');
    await rows.first().click();

    // The close-before-navigate ordering, observed from OUTSIDE: a sheet left mounted
    // across the transition would put an overlay and a focus trap over the destination.
    await expect(page).toHaveURL(/\/gameDetail\?/);
    await expect(
      calendarSheet(page),
      'the calendar sheet survived the navigation — the handler must close it BEFORE router.push, not after',
    ).toBeHidden();
  });

  test('no fixed element occludes the Footer /Privacy link', async ({ page }, testInfo) => {
    await page.goto('/');
    await assertDarkTheme(page);

    /*
     * INVERTED Phase 88.5 plan 10 (T-88.5-32). This test used to resolve the phone bottom
     * bar and compare the /Privacy link's bottom edge against that bar's measured top edge.
     * The bar was deleted in plan 88.5-07 — and deleting this test with it would have
     * retired the ONLY guard the `/Privacy` link has ever had, for a path CLAUDE.md records
     * as load-bearing for Google auth.
     *
     * So the assertion is generalised rather than removed: it no longer names an occluder at
     * all. It asks whether the link actually RECEIVES A POINTER, which is true of every
     * occluder — a fixed bar, a sticky toolbar, a toast container, a full-page overlay left
     * mounted by a dialog — and stays true after the next one is added. Re-narrowing this to
     * a named element is a decision, not a cleanup.
     */

    // MEASUREMENT ONLY (plan 88.1-19), sampled TWICE — before and after the scroll —
    // because part of the open question is whether the scroll landed at all.
    //
    // The recorded failure was a GEOMETRY comparison (link bottom 702px vs occluder top
    // 612px), and 702 in a 667px viewport is 35px past the fold. `scrollTop` vs
    // `maxScrollTop` settles cheaply whether `window.scrollTo(0, document.body.scrollHeight)`
    // actually reached the bottom — an under-scroll explains those numbers.
    // `88.1-REVIEW.md` IN-01's loading-branch theory predicts a DIFFERENT failure shape (no
    // `/Privacy` link renders in that state at all, so `guardResolved` would fail first),
    // which is why the auth-state discriminator is reported alongside the geometry rather
    // than assumed. `privacyHref` is READ, never written — the capital P is load-bearing for
    // Google auth (CLAUDE.md).
    await attachDiagnostics(testInfo, 'privacy-occlusion-initial', await probeFooterOcclusion(page));

    // Scroll to the very bottom — the only place the Footer and a bottom-anchored fixed
    // element can collide. This USED TO be a one-shot
    // `window.scrollTo(0, document.body.scrollHeight)`, which plan 88.1-19 measured racing
    // the page's own content; see scrollToSettledBottom's block.
    const landedScroll = await scrollToSettledBottom(page);

    await attachDiagnostics(testInfo, 'privacy-occlusion-after-scroll', {
      ...(await probeFooterOcclusion(page)),
      landedScroll,
    });

    // `/Privacy` keeps its capital P deliberately (CLAUDE.md: required for Google auth).
    const privacy = page.getByRole('link', { name: 'Privacy', exact: true });
    await guardResolved(privacy, 'the Footer /Privacy link');
    await expect(privacy).toHaveAttribute('href', '/Privacy');

    /*
     * TWO probe points, and the BOTTOM EDGE is the one that can actually fail.
     *
     * The centre is the point named in the plan and it catches a full-coverage overlay. It
     * is also the LAST point any partial occluder reaches, so on its own it is close to
     * vacuous against the failure mode this project has actually shipped — a bottom-anchored
     * `fixed` element creeping up over the footer from below. The bottom edge is the FIRST
     * point such an element touches, which is the same edges-not-centres reasoning
     * `touch-targets.spec.ts`'s D-13 test records for hit extensions. Both are asserted.
     *
     * Everything is read in ONE evaluate: `elementFromPoint` only resolves points inside the
     * viewport and takes VISUAL-viewport-independent client coordinates, so measuring with
     * Playwright's (visual-viewport-SCALED) `boundingBox()` and probing afterwards would mix
     * two coordinate systems on an emulated phone.
     */
    const probe = await privacy.first().evaluate((link) => {
      const r = link.getBoundingClientRect();
      const hit = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return {
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          // The link ITSELF or something inside it. An ANCESTOR is deliberately not
          // accepted: `elementFromPoint` returns the innermost element at the point, so an
          // ancestor coming back means the point is not over the link's own box.
          reachesLink: el === link || link.contains(el),
          tag: el instanceof Element ? el.tagName : 'none',
          text: (el?.textContent ?? '').trim().slice(0, 40),
        };
      };

      // Diagnostic only: which fixed/sticky elements overlap the link's box. Reported in
      // the failure message so a red run names the culprit instead of only the symptom.
      const overlaps: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const position = getComputedStyle(el).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.right <= r.left || box.left >= r.right || box.bottom <= r.top || box.top >= r.bottom) continue;
        overlaps.push(
          `<${el.tagName.toLowerCase()} position:${position} aria-label="${el.getAttribute('aria-label') ?? ''}" rect=${Math.round(box.top)}..${Math.round(box.bottom)}>`,
        );
      }

      return {
        centre: hit(r.left + r.width / 2, r.top + r.height / 2),
        bottomEdge: hit(r.left + r.width / 2, r.bottom - 2),
        linkRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
        overlaps,
      };
    });

    const culprits = probe.overlaps.length
      ? ` Fixed/sticky elements overlapping the link's box: ${probe.overlaps.join(', ')}.`
      : ' No fixed or sticky element overlaps the link box, so the occluder is something else — a transformed ancestor, a stacking-context sibling, or an oversized pseudo-element.';

    expect(
      probe.centre.reachesLink,
      `the point at the CENTRE of the /Privacy link (${probe.centre.x},${probe.centre.y}) hit <${probe.centre.tag}> "${probe.centre.text}" instead of the link — something is covering it. /Privacy (capital P) is load-bearing for Google auth (CLAUDE.md), and the Footer is a SIBLING of <main> (layout.js:86-91), so page padding cannot clear it: whatever is covering it has to stop covering it.${culprits}`,
    ).toBe(true);
    expect(
      probe.bottomEdge.reachesLink,
      `the point 2px inside the BOTTOM EDGE of the /Privacy link (${probe.bottomEdge.x},${probe.bottomEdge.y}) hit <${probe.bottomEdge.tag}> "${probe.bottomEdge.text}" instead of the link — a bottom-anchored fixed element is creeping over it. This edge is the FIRST point such an element reaches and the centre above is the LAST, which is why both are probed.${culprits}`,
    ).toBe(true);

    // Geometry alone is not enough: "found the element" is the vacuous shape this file's
    // guard rule forbids, and a covered link can still have a clean bounding box. A trial
    // click runs Playwright's full actionability pipeline — visible, stable, and the
    // HIT TARGET actually receives the pointer — without navigating.
    await privacy.click({ trial: true, timeout: 5000 });
  });
});

test.describe('Phase 88.5 Req 2/3 — the counted button and the hero, LIGHT (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet requirements — phone project only');

  // UI-SPEC section 12 item 14: the hero and BOTH pills are asserted in both themes. The
  // pill's colour genuinely forks (amber-700 on white in light, amber-500 on warm-900 in
  // dark, `UpcomingCountPill.tsx:126-128`) and so does the chip/card treatment beneath the
  // hero, so a dark-only pass leaves one shipped arm rendered by nothing.
  //
  // BOTH halves of the theme mechanism, exactly as `contrast.spec.ts:400-412` records:
  // `colorScheme` is emulation and governs UA chrome only; the `<html class>` comes from the
  // next-themes localStorage key that `forceLightMode` writes through an init script. Neither
  // implies the other, and `assertTheme` below proves the class actually landed.
  test.use({ colorScheme: 'light' });

  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
  });

  test('SPEC Req 2/3 in LIGHT: the counted button, the NEXT GAME NIGHT hero and the This week pill', async ({
    page,
  }) => {
    await page.goto('/');
    await assertTheme(page, 'light');

    const count = await assertCountedCalendarButton(page);

    await calendarButton(page).click();
    await expect(calendarSheet(page)).toBeVisible();

    await assertHeroLeadsTheSheet(page, count);
  });
});

test.describe('Phase 88.1 Req 11 — the phone surface does not render at desktop width', () => {
  // The ">=768px unchanged" half, asserted in the DESKTOP project at its real width
  // rather than by resizing inside the phone project (see the PROJECT SPLIT note above).
  test.skip(({ isMobile }) => Boolean(isMobile), 'this is the desktop half — journeys project only');

  // AMENDED Phase 88.5 plan 10: the bar half of this test is gone with the bar. The Calendar
  // button half is unchanged and is now the whole of it — the `md:hidden` gate on that button
  // is still the only thing keeping a phone control off the desktop layout.
  test('the Calendar button is absent, and the desktop column is present', async ({
    page,
  }) => {
    await page.goto('/');

    // Positive control FIRST: without it, a home page that failed to render at all would
    // pass the negative assertion vacuously.
    await guardResolved(desktopColumnHeading(page), 'the desktop Upcoming Events column');

    await expect(
      calendarButton(page),
      'the phone Calendar button is visible at desktop width — its md:hidden gate is not holding',
    ).toBeHidden();
  });
});
