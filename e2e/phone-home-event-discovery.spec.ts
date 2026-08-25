import { test, expect, type Locator, type Page } from '@playwright/test';
// Plan 88.1-19 MEASUREMENT instruments — read-only attachments, no assertions, and NOT a
// spec file so Playwright cannot collect it as a suite. See `e2e/support/diagnostics.ts`.
import { attachDiagnostics, probeFooterOcclusion } from './support/diagnostics';

/**
 * Phase 88.1 plan 10 — SPEC Req 11 (both phone event-discovery surfaces on the
 * logged-in home page), gated at 375x667.
 *
 * WHY THIS FILE IS THE GATE AND THE VITEST PINS ARE NOT: `UserHomePage.phone.test.tsx`
 * (Req 11a) and `UserHomePage.calendarSheet.test.tsx` (Req 11b) pin every branch jsdom
 * can see — count integrity, error-before-empty, mount counts, dismiss paths. They
 * cannot see LAYOUT, because jsdom has none. Everything measured here is therefore a
 * thing no unit test can assert: the 44x44 touch floor, the readable game text, the
 * below-`md` / at-`md` split, and above all the FOOTER OCCLUSION check — `Footer` is a
 * SIBLING of `<main>` (`layout.js:86-91`), so the phone bar's `fixed bottom-0` can cover
 * the `/Privacy` link with no DOM change at all. Plan 88.1-08 verified that only
 * structurally and handed the real gate here.
 *
 * `/Privacy` (capital P) is load-bearing for Google auth (CLAUDE.md) — this spec asserts
 * REACHABILITY, and must never be "fixed" by lowercasing the path it looks for.
 *
 * WHAT IS PINNED
 *   1. below `md`: the Upcoming Events bar renders and the desktop right column does not
 *   2. one tap opens the 11a sheet; Esc and the close button each dismiss it
 *   3. the Calendar button renders above the group list and measures >= 44x44
 *   4. the calendar sheet's rows show READABLE game text — 16px, unclipped
 *   5. tapping an event navigates AND leaves no sheet behind (the close-before-navigate
 *      ordering, observed from outside — React batches both into one commit, so this is
 *      the only layer that can observe the outcome at all)
 *   5b. (Req 12, plan 88.1-17) the calendar sheet opens on the UPCOMING section with the
 *      past collapsed: the disclosure is present, reports itself collapsed, controls a
 *      hidden region and meets the 44px floor; expanding it flips aria-expanded and
 *      strictly increases the row count. That last delta is the non-vacuity guard — a
 *      seeded account with no history would otherwise make the case measure nothing.
 *   6. the Footer's /Privacy link is visible AND hit-testable with the bar mounted
 *   7. at DESKTOP width neither phone surface renders (the ">=768px unchanged" half)
 *
 * PROJECT SPLIT — stated explicitly, as the plan requires. Rows 1-6 run in the `phone`
 * project only; row 7 runs in the desktop `journeys` project only, at its real 1280px
 * width. Both projects match every spec (`playwright.config.ts:45`, `:97`), so each
 * describe carries the opposite skip rather than resizing a viewport by hand: an
 * emulated resize inside the phone project would keep `isMobile`/`hasTouch` set and
 * measure a viewport the app is never actually served at.
 *
 * SELECTOR POLICY: role/label/text only, never Tailwind classes (invite.spec.ts:18).
 * Geometry is read from `boundingBox()` / computed style — the layer where it is real.
 *
 * Fixtures follow the env-const idiom. Nothing new is minted here: this spec drives the
 * logged-in home page through the shared `storageState`, so it needs no id at all beyond
 * the existing seeded account. e2e is CI-only by design (`playwright.config.ts:19-21`) —
 * author locally, verify in CI.
 */

/** The phone bar's own height (`PhoneEventBar.tsx` `h-14`). Used only to explain a
 *  failure, never as the source of the occlusion assertion — that reads the bar's
 *  MEASURED top edge. */
const PHONE_BAR_HEIGHT = 56;

/**
 * Scroll to the true bottom of the page, AFTER the page has stopped growing, and prove the
 * scroll landed before anything is measured.
 *
 * WHY (plan 88.1-19 measured it, run 32774690333). The failing attempt read
 * `documentScrollHeight = 667`, `maxScrollTop = 0`, `scrollTop = 0` at BOTH samples: the page
 * had not grown yet, so the one-shot `window.scrollTo(0, document.body.scrollHeight)` was a
 * no-op against a page with nothing to scroll. Content landed a moment later and the test's own
 * read then saw the `/Privacy` link at 702.1875px against a bar top of 612px. The passing retry
 * had the content already present at `goto` (`documentScrollHeight = 826`, `maxScrollTop = 159`)
 * and read 543.188 after scrolling. 543.188 + 159 = 702.188 — the arithmetic closes exactly on
 * the recorded failure number, so this is a scroll race and nothing else.
 *
 * What it is NOT: a spacer bug or an auth-branch bug. `spacerPresent: true` with
 * `spacerRect.height = 56`, and `authFooterPresent: true` with `loadingPlaceholderLikely: false`,
 * in ALL FOUR samples including the failing one. `88.1-REVIEW.md` IN-01's loading-branch theory
 * is refuted by measurement; the Footer contract hole it names is real but is a different thing,
 * closed separately in `Footer.js`.
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

/** Vacuity guard (touch-targets.spec.ts:63 / availability-grid-touch.spec.ts:64): a
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

/** D-11 dark-theme pre-assertion (touch-targets.spec.ts:130): a computed-style read in
 *  light mode would be meaningless and its failure misdiagnosed. */
async function assertDarkTheme(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveClass(/dark/);
}

const phoneBar = (page: Page) =>
  page.getByRole('button', { name: /^open upcoming events/i });
const calendarButton = (page: Page) => page.getByRole('button', { name: /^calendar$/i });
const upcomingSheet = (page: Page) => page.getByRole('dialog', { name: 'Upcoming events' });
const calendarSheet = (page: Page) => page.getByRole('dialog', { name: 'Calendar' });
/** The desktop right column's own heading (`UpcomingEventsCard.js:140`). It stays in the
 *  DOM below `md` — the column is `hidden md:flex` — so this is a VISIBILITY assertion,
 *  never a presence one. */
const desktopColumnHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Upcoming Events', exact: true });

/** Req 12 (plan 88.1-17): the calendar sheet's event rows, in DOM order. `EventRow`'s
 *  title is an `<h5>`, and it falls back to the game name for the seeded row shape —
 *  the same locator the readable-game-text case above relies on. */
const sheetRowHeadings = (page: Page) =>
  calendarSheet(page).getByRole('heading', { level: 5 });

/** Req 12: the past disclosure. The COUNT is part of its accessible name by
 *  requirement, so the locator asserts the shape while staying data-agnostic. */
const pastDisclosure = (page: Page) =>
  calendarSheet(page).getByRole('button', { name: /^past events \(\d+\)$/i });

/** Named in every Req 12 fixture-dependent failure message. A seeded account with no
 *  event history makes the expand case vacuous, and that is a FIXTURE failure — never a
 *  pass. `seed-sample-data.js` is what actually seeds past events (7 of them, -1 to -14
 *  days); `e2e-fixtures.js` owns the invariant that the e2e account still sees them. */
const FIXTURE_OWNER =
  'periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js (past rows come from seed-sample-data.js)';

test.describe('Phase 88.1 Req 11 — phone event discovery (phone project)', () => {
  // Inverse of tailwind-v4-styles.spec.ts:57 and the same shape as
  // touch-targets.spec.ts:138 — Req 11 is a phone-tenet requirement measured at 375x667.
  test.skip(({ isMobile }) => !isMobile, 'Req 11 is a phone-tenet requirement — phone project only');

  test('11a: the bottom bar replaces the desktop column and opens its sheet in one tap', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const bar = phoneBar(page);
    await guardResolved(bar, 'the phone Upcoming Events bar (PhoneEventBar)');

    // The phone surface is a DESIGNED presentation, not the desktop column un-hidden:
    // the column's own heading must not be visible at this width.
    await expect(
      desktopColumnHeading(page),
      'the desktop right column is visible at 375px — the phone bar is meant to REPLACE it below md, not sit alongside it',
    ).toBeHidden();

    // One tap, one sheet.
    await bar.click();
    await expect(upcomingSheet(page)).toBeVisible();
    // Content, not an empty shell: the card's own heading renders inside the sheet.
    //
    // DISAMBIGUATED BY LEVEL (plan 88.1-17; CI run 32653244426 failed here on strict
    // mode). TWO headings match "Upcoming Events" inside this dialog: the sheet's own
    // Radix `DialogTitle` <h2>"Upcoming events" (BottomSheet.tsx, title from
    // UserHomePage.js) and UpcomingEventsCard's <h3>"Upcoming Events". Playwright's
    // accessible-name match is case-insensitive and substring unless `exact` is set, so
    // the un-levelled locator resolved both. `level: 3` is the CARD's heading and is
    // robust to a copy-case change in either place — do not "simplify" the level back out.
    await expect(
      upcomingSheet(page).getByRole('heading', { level: 3, name: 'Upcoming Events', exact: true }),
    ).toBeVisible();

    // Dismiss path 1: Escape.
    await page.keyboard.press('Escape');
    await expect(upcomingSheet(page)).toBeHidden();

    // Dismiss path 2: the close button.
    await bar.click();
    await expect(upcomingSheet(page)).toBeVisible();
    await upcomingSheet(page).getByRole('button', { name: /close/i }).click();
    await expect(upcomingSheet(page)).toBeHidden();
  });

  test('11b: the Calendar button meets the 44x44 floor and opens the calendar sheet', async ({
    page,
  }) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const button = calendarButton(page);
    await guardResolved(button, 'the phone Calendar button (Req 11b entry point)');
    await assertMin44(button, 'the phone Calendar button');

    await button.click();
    await expect(calendarSheet(page)).toBeVisible();
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
    const rowHeading = sheet.getByRole('heading', { level: 5 }).first();
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
    // button is the close control.
    const rows = sheet
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { level: 5 }) });
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

  test('the fixed bar does not occlude the Footer /Privacy link', async ({ page }, testInfo) => {
    await page.goto('/');
    await assertDarkTheme(page);

    const bar = phoneBar(page);
    await guardResolved(bar, 'the phone Upcoming Events bar (the occluding element under test)');

    // MEASUREMENT ONLY (plan 88.1-19), sampled TWICE — before and after the scroll —
    // because part of the open question is whether the scroll landed at all.
    //
    // The recorded failure is a GEOMETRY comparison (link bottom 702px vs bar top 612px),
    // and 702 in a 667px viewport is 35px past the fold. `scrollTop` vs `maxScrollTop`
    // settles cheaply whether `window.scrollTo(0, document.body.scrollHeight)` actually
    // reached the bottom — an under-scroll explains those numbers; a missing 56px spacer
    // does not. `88.1-REVIEW.md` IN-01's loading-branch theory predicts a DIFFERENT
    // failure shape (no `/Privacy` link renders in that state at all, so `guardResolved`
    // would fail first), which is why the auth-state discriminator is reported alongside
    // the geometry rather than assumed. `privacyHref` is READ, never written — the capital
    // P is load-bearing for Google auth (CLAUDE.md). Read-only; concluded in plan 20.
    await attachDiagnostics(testInfo, 'privacy-occlusion-initial', await probeFooterOcclusion(page));

    // Scroll to the very bottom — the only place the Footer and the fixed bar can collide.
    // This USED TO be a one-shot `window.scrollTo(0, document.body.scrollHeight)`, which plan
    // 88.1-19 measured racing the page's own content; see scrollToSettledBottom's block.
    const landedScroll = await scrollToSettledBottom(page);

    await attachDiagnostics(testInfo, 'privacy-occlusion-after-scroll', {
      ...(await probeFooterOcclusion(page)),
      landedScroll,
    });

    // `/Privacy` keeps its capital P deliberately (CLAUDE.md: required for Google auth).
    const privacy = page.getByRole('link', { name: 'Privacy', exact: true });
    await guardResolved(privacy, 'the Footer /Privacy link');
    await expect(privacy).toHaveAttribute('href', '/Privacy');

    const barBox = await bar.boundingBox();
    const linkBox = await privacy.boundingBox();
    expect(barBox, 'the phone bar has no boundingBox').not.toBeNull();
    expect(linkBox, 'the /Privacy link has no boundingBox').not.toBeNull();
    if (!barBox || !linkBox) return;

    expect(
      linkBox.y + linkBox.height,
      `the /Privacy link's bottom edge (${linkBox.y + linkBox.height}px) sits below the bar's top edge (${barBox.y}px) — the ${PHONE_BAR_HEIGHT}px fixed bar is covering it. The mechanism is the Footer's own gated spacer (Footer.js, driven by phoneBottomBarPresence); page padding cannot reach the Footer because it is a SIBLING of <main> (layout.js:86-91).`,
    ).toBeLessThanOrEqual(barBox.y);

    // Geometry alone is not enough: "found the element" is the vacuous shape this file's
    // guard rule forbids, and a covered link can still have a clean bounding box. A trial
    // click runs Playwright's full actionability pipeline — visible, stable, and the
    // HIT TARGET actually receives the pointer — without navigating.
    await privacy.click({ trial: true, timeout: 5000 });
  });
});

test.describe('Phase 88.1 Req 11 — neither phone surface renders at desktop width', () => {
  // The ">=768px unchanged" half, asserted in the DESKTOP project at its real width
  // rather than by resizing inside the phone project (see the PROJECT SPLIT note above).
  test.skip(({ isMobile }) => Boolean(isMobile), 'this is the desktop half — journeys project only');

  test('the bar and the Calendar button are absent, and the desktop column is present', async ({
    page,
  }) => {
    await page.goto('/');

    // Positive control FIRST: without it, a home page that failed to render at all would
    // pass both negative assertions vacuously.
    await guardResolved(desktopColumnHeading(page), 'the desktop Upcoming Events column');

    await expect(
      phoneBar(page),
      'the phone bottom bar is visible at desktop width — its md:hidden gate is not holding',
    ).toBeHidden();
    await expect(
      calendarButton(page),
      'the phone Calendar button is visible at desktop width — its md:hidden gate is not holding',
    ).toBeHidden();
  });
});
