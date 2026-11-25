import { test, expect, type Locator, type Page } from '@playwright/test';

import { E2E_GAME_PATH, routeFakeGameSuccess } from './support/fakeGame';
import { E2E_GROUP_ID } from './support/groupSettings';

// Phase 88.9 plan 59 (owner fix rows 52-X5 a / b / c and 52-X12): the RENDERED page widths.
//
// The owner looked at the built pages on a wide screen (the 88.9-51 glance, 2026-11-11) and ruled:
// the header, the footer and the Home body widen toward 1600 (X5a); the group, game and planning
// bodies read better at 1280 and stay there under the wider header (X5c). The class strings are
// held by src/app/pageWidth.test.ts ("the header nav class string"); a class string proves
// nothing about what a browser paints (a parent can cap or pad a box), so the boxes are measured
// here, in Chromium, at the widths the owner looked at.
//
// HOW A WIDTH IS READ: the viewport width is the root element's client width, which leaves out
// any vertical scrollbar, so the expected box never depends on whether the page scrolls. A box is
// its bounding rectangle. Every comparison allows one pixel for sub-pixel rounding.
//
// DESKTOP describe: the journeys project, resized per width inside the test. PHONE describe: the
// phone project at its own 375 viewport, a confirm that nothing here changes a phone.
//
// READ-ONLY: the spec navigates and resizes. The game view is served the shared fake custom game
// (e2e/support/fakeGame.ts ("export async function routeFakeGameSuccess(")), which answers two
// GETs in the browser and writes nothing.
//
// CI-RUN ONLY: both projects need the stored sign-in, which exists only in CI. Typechecked and
// listed locally, not run. Failure lines carry widths and offsets only, never page text.

const HOME = '/';
const GROUP_PAGE = `/groupHomePage?id=${E2E_GROUP_ID}`;
const PLANNING_PAGE = `/groupPlanning?group_id=${E2E_GROUP_ID}`;
const HEIGHT = 900;
const WIDE_CAP = 1600; // 100rem
const READING_CAP = 1280; // 7xl
const TOLERANCE = 1;

interface Box {
  left: number;
  width: number;
}

async function boxOf(anchor: Locator): Promise<Box> {
  return anchor.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
}

/** The layout width: the root element's client width (no scrollbar). */
async function layoutWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.clientWidth);
}

/** The box is `expected` wide and centred in a layout `w` wide, each within one pixel. */
function expectCentredBox(label: string, box: Box, w: number, expected: number): void {
  const where = `${label}: width ${box.width.toFixed(2)}, left ${box.left.toFixed(2)} in a ${w}px layout (expected width ${expected}, left ${((w - expected) / 2).toFixed(2)})`;
  expect(Math.abs(box.width - expected), where).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(box.left - (w - expected) / 2), where).toBeLessThanOrEqual(TOLERANCE);
}

function mainNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main', exact: true });
}

function footerStrip(page: Page): Locator {
  return page.locator('footer > div').first();
}

/** Resize, then wait until the layout has taken the new width. */
async function resizeTo(page: Page, width: number): Promise<number> {
  await page.setViewportSize({ width, height: HEIGHT });
  await expect
    .poll(async () => Math.abs((await layoutWidth(page)) - width), { message: `the layout never took the ${width}px viewport` })
    .toBeLessThanOrEqual(20);
  return layoutWidth(page);
}

test.describe('page width at desktop — X5 (88.9-59)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-only: the wide-screen page widths of X5');

  test('X5a (88.9): at 1280, 1440, 1600 and 1920 the header nav, the footer strip and the home body are one box, the viewport width up to 1600, centred', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: HEIGHT });
    await page.goto(HOME);
    await expect(page.getByRole('heading', { level: 2, name: 'Your Groups' })).toBeVisible({ timeout: 15_000 });
    await expect(footerStrip(page)).toBeVisible();

    for (const width of [1280, 1440, 1600, 1920]) {
      const w = await resizeTo(page, width);
      const expected = Math.min(w, WIDE_CAP);
      await expect(async () => {
        expectCentredBox(`header nav at ${width}`, await boxOf(mainNav(page)), w, expected);
        expectCentredBox(`footer strip at ${width}`, await boxOf(footerStrip(page)), w, expected);
        expectCentredBox(`home body at ${width}`, await boxOf(page.locator('.user-home-container')), w, expected);
      }).toPass({ timeout: 5_000 });
    }
  });

  test('X5c (88.9): at 1600 and 1920 the group, game and planning bodies stay 1280 wide and centred under the 1600 header nav', async ({ page }) => {
    await routeFakeGameSuccess(page);
    await page.setViewportSize({ width: 1600, height: HEIGHT });

    const pages = [
      { name: 'group page', path: GROUP_PAGE },
      { name: 'game view', path: E2E_GAME_PATH },
      { name: 'planning page', path: PLANNING_PAGE },
    ];
    for (const { name, path } of pages) {
      await page.goto(path);
      const main = page.locator('main');
      await expect(main.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible({ timeout: 15_000 });
      const body = main.locator('.max-w-7xl.mx-auto').first();

      for (const width of [1600, 1920]) {
        const w = await resizeTo(page, width);
        await expect(async () => {
          expectCentredBox(`${name} body at ${width}`, await boxOf(body), w, READING_CAP);
          expectCentredBox(`header nav over the ${name} at ${width}`, await boxOf(mainNav(page)), w, Math.min(w, WIDE_CAP));
        }).toPass({ timeout: 5_000 });
      }
    }
  });

  test('X5b + X12 (88.9): at 1024, 1280 and 1600 the home groups column is clamp(320px, 42vw, 460px) wide and the group list fills it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: HEIGHT });
    await page.goto(HOME);
    const heading = page.getByRole('heading', { level: 2, name: 'Your Groups' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    for (const width of [1024, 1280, 1600]) {
      await resizeTo(page, width);
      await expect(async () => {
        // The list is the heading's own card; the column is two levels up (the card sits in the
        // column's absolutely positioned inner box). A vw unit counts any scrollbar, so the
        // expected width is taken from the window's inner width, not the layout width.
        const read = await heading.evaluate((el) => {
          const list = el.closest('.rounded-card');
          const column = list?.parentElement?.parentElement ?? null;
          if (!list || !column) return null;
          // 89.6-16 (H-01): the first group card fills the list's content box.
          const card = list.querySelector('[data-testid="group-card"]');
          const style = getComputedStyle(list);
          return {
            list: list.getBoundingClientRect().width,
            column: column.getBoundingClientRect().width,
            inner: window.innerWidth,
            card: card ? card.getBoundingClientRect().width : null,
            content: list.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          };
        });
        expect(read, 'the group list card or its column was not found').not.toBeNull();
        if (!read) return;
        const expected = Math.min(Math.max(320, 0.42 * read.inner), 460);
        const where = `at ${width}: column ${read.column.toFixed(2)}, list ${read.list.toFixed(2)}, expected ${expected.toFixed(2)} (42vw of ${read.inner})`;
        expect(Math.abs(read.column - expected), where).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(read.list - read.column), where).toBeLessThanOrEqual(TOLERANCE);
        expect(read.card, `at ${width}: no group card in the list`).not.toBeNull();
        expect(
          Math.abs((read.card ?? 0) - read.content),
          `at ${width}: the group cards do not fill the list (register H-01): card ${read.card?.toFixed(2)}, list content box ${read.content.toFixed(2)}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }).toPass({ timeout: 5_000 });
    }
  });
});

test.describe('page width on a phone — X5 (88.9-59)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-only: the 375 confirm of X5');

  test('X5 (88.9): at 375 the header nav, home body and footer strip span the phone width, the group list fills the body and nothing scrolls sideways', async ({ page }) => {
    await page.goto(HOME);
    const heading = page.getByRole('heading', { level: 2, name: 'Your Groups' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(footerStrip(page)).toBeVisible();

    const w = await layoutWidth(page);
    expectCentredBox('header nav at 375', await boxOf(mainNav(page)), w, w);
    expectCentredBox('home body at 375', await boxOf(page.locator('.user-home-container')), w, w);
    expectCentredBox('footer strip at 375', await boxOf(footerStrip(page)), w, w);

    // The list is the heading's own card; it fills the body's content box (the body's padding is
    // read, not assumed).
    const fill = await heading.evaluate((el) => {
      const list = el.closest('.rounded-card');
      const body = document.querySelector('.user-home-container');
      if (!list || !body) return null;
      const style = getComputedStyle(body);
      const bodyRect = body.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      return {
        listLeft: listRect.left,
        listRight: listRect.right,
        contentLeft: bodyRect.left + parseFloat(style.paddingLeft),
        contentRight: bodyRect.right - parseFloat(style.paddingRight),
      };
    });
    expect(fill, 'the group list card or the home body was not found').not.toBeNull();
    if (fill) {
      const where = `list ${fill.listLeft.toFixed(2)}..${fill.listRight.toFixed(2)}, body content ${fill.contentLeft.toFixed(2)}..${fill.contentRight.toFixed(2)}`;
      expect(Math.abs(fill.listLeft - fill.contentLeft), where).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(fill.listRight - fill.contentRight), where).toBeLessThanOrEqual(TOLERANCE);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `the page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  });
});
