import { test, expect, type Locator, type Page } from '@playwright/test';

import { assertTheme, contrastRatio, focusByKeyboard, forceLightMode } from './support/contrast';
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

// Phase 88.9 plan 68: the owner's Profile look fixes, read in a real browser. jsdom applies no
// stylesheet and performs no layout, so src/app/userProfile/page.test.tsx pins the DOM contract
// (which cards mount, what is inert, where focus lands) and this spec reads what a person sees:
// sizes, edges, colours and where a tap or a Tab can go.
//
// BOTH PROJECTS, NO SKIP. phone (375 x 667) and journeys (1280 x 720) run every test; where the
// two differ (three cards or six) the test branches on the project name, it never skips.
//
// NOTHING IS WRITTEN TO THE BACKEND. The owned-games read is answered in the browser with this
// file's own fixtures, and holdWrites keeps every write in the browser; afterEach fails the test
// when a write nobody mocked reached the hold. The fixture account's real collection decides
// nothing here.
//
// NOT RUN LOCALLY. Both projects depend on the setup project, which signs in with credentials that
// are deliberately absent locally. Typecheck and listing are the local proof; CI is the proof.

const OWNED_GAMES_PATH = /\/user-games\/user\/[^/]+$/;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const NAMES = LETTERS.map((letter) => `E2E Shelf ${letter}`);
const EIGHT = NAMES.map((name, index) => ({
  id: `e2e-shelf-${LETTERS[index].toLowerCase()}`,
  name,
  bgg_id: 990301 + index,
  year_published: 2001 + index,
  image_url: null,
}));

// 1.20 is the house floor for two fills that must read apart; 4.5 is WCAG AA for text.
const FILL_FLOOR = 1.2;
const TEXT_FLOOR = 4.5;

function collectionCard(page: Page): Locator {
  return page.locator('div.card').filter({ has: page.getByRole('heading', { level: 2, name: /^My Game Collection/ }) });
}

// One locator for the bar in both states: it is the same node, renamed.
function collectionBar(page: Page): Locator {
  return collectionCard(page).getByRole('button', { name: /^(Show all 8 games|Show fewer)$/ });
}

function reachableRemoves(page: Page): Locator {
  return collectionCard(page).getByRole('button', { name: /^Remove E2E Shelf [A-H]$/ });
}

async function openProfileWithEightGames(page: Page): Promise<WriteHold> {
  const hold = await holdWrites(page, {
    answerGet: (url) => (OWNED_GAMES_PATH.test(url.pathname) ? EIGHT : undefined),
  });
  await page.goto('/userProfile');
  return hold;
}

function ratio(a: string, b: string, what: string): number {
  const value = contrastRatio(a, b);
  expect(value, `${what}: could not read a ratio from ${a} and ${b}`).not.toBeNull();
  return value ?? 0;
}

test.describe('Profile look fixes (plan 88.9-68)', () => {
  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test("X52d (88.9-68): the collection bar is 48px, flush to the card's bottom edge, opens the rest with focus on the first revealed game's title, closes it with focus kept on the bar, and the peeked card cannot be tapped or tabbed to", async ({ page }, testInfo) => {
    backstop = await openProfileWithEightGames(page);
    const phone = testInfo.project.name === 'phone';
    if (phone) expect(page.viewportSize()?.width).toBe(375);
    // Three cards on a phone and one peek; six from md, and with eight games the two left peek.
    const visible = phone ? 3 : 6;
    const peeked = phone ? 1 : 2;

    const collection = collectionCard(page);
    const bar = collectionBar(page);
    await expect(bar, 'X52d: the collection bar never rendered over eight games').toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveAccessibleName('Show all 8 games');
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await expect(reachableRemoves(page)).toHaveCount(visible);
    const peeks = collection.locator('[inert]');
    await expect(peeks).toHaveCount(peeked);

    // The bar: at least 48 tall and flush with the card's left, right and bottom edges; the fade
    // over the peek is a gradient. Read in one evaluate so the boxes belong to one layout.
    const geometry = await bar.evaluate((el) => {
      const card = el.closest('.card');
      const grid = document.getElementById(el.getAttribute('aria-controls') ?? '');
      if (!card || !grid) return null;
      const b = el.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const fade = grid.lastElementChild;
      return {
        height: b.height,
        left: Math.abs(b.left - c.left),
        right: Math.abs(c.right - b.right),
        bottom: Math.abs(c.bottom - b.bottom),
        fade: fade ? getComputedStyle(fade).backgroundImage : '',
      };
    });
    expect(geometry, 'X52d: the bar has no card around it or controls no grid').not.toBeNull();
    if (geometry) {
      const read = JSON.stringify(geometry);
      expect(geometry.height, `X52d: the bar is under 48px tall (${read})`).toBeGreaterThanOrEqual(48);
      expect(geometry.left, `X52d: the bar is not flush with the card's left edge (${read})`).toBeLessThanOrEqual(1);
      expect(geometry.right, `X52d: the bar is not flush with the card's right edge (${read})`).toBeLessThanOrEqual(1);
      expect(geometry.bottom, `X52d: the bar is not flush with the card's bottom edge (${read})`).toBeLessThanOrEqual(1);
      expect(geometry.fade, `X52d: the peek has no fade over it (${read})`).toContain('linear-gradient');
    }

    // Tab from the last visible card's Remove goes straight to the bar: the peek takes no stop.
    await focusByKeyboard(page, collection.getByRole('button', { name: `Remove ${NAMES[visible - 1]}`, exact: true }));
    await page.keyboard.press('Tab');
    await expect(bar, 'X52d: Tab from the last visible Remove did not reach the bar').toBeFocused();

    // A press where the peeked card's Remove is drawn arms nothing (and afterEach proves it sent nothing).
    const peekRemove = await peeks.first().locator('button').boundingBox();
    expect(peekRemove, 'X52d: the peeked Remove has no box to aim at').not.toBeNull();
    if (peekRemove) {
      await page.mouse.click(peekRemove.x + peekRemove.width / 2, peekRemove.y + peekRemove.height / 2);
    }
    await expect(collection.locator('[aria-pressed="true"]'), 'X52d: a press on the peeked card armed a Remove').toHaveCount(0);
    await expect(bar).toHaveAttribute('aria-expanded', 'false');

    // Enter opens: every game, focus on the first revealed game's title, and Tab goes on to its Remove.
    await focusByKeyboard(page, bar);
    await page.keyboard.press('Enter');
    await expect(bar).toHaveAttribute('aria-expanded', 'true');
    await expect(bar).toHaveAccessibleName('Show fewer');
    await expect(reachableRemoves(page)).toHaveCount(8);
    await expect(peeks).toHaveCount(0);
    await expect(
      collection.getByRole('heading', { level: 3, name: NAMES[visible], exact: true }),
      "X52d: opening did not land focus on the first revealed game's title",
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(collection.getByRole('button', { name: `Remove ${NAMES[visible]}`, exact: true })).toBeFocused();

    // Back on the bar, Enter closes: focus stays on the bar and the bar is on screen.
    await bar.focus();
    await page.keyboard.press('Enter');
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await expect(reachableRemoves(page)).toHaveCount(visible);
    await expect(bar, 'X52d: closing moved focus off the bar').toBeFocused();
    await expect(bar, 'X52d: after closing the bar is off screen').toBeInViewport();

    // Opened, then a fresh visit: closed again (nothing is remembered).
    await page.keyboard.press('Enter');
    await expect(bar).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await expect(reachableRemoves(page)).toHaveCount(visible);

    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'X52d: horizontal overflow on the collection card').toBe(true);
  });

  test('X56c + X52d (88.9-68): in dark each card takes the raised fill, the bar and the cards stay at least 1.20 from the card ground, and the bar keeps its 1px top rule; light cards stay unfilled', async ({ page }, testInfo) => {
    backstop = await openProfileWithEightGames(page);
    if (testInfo.project.name === 'phone') expect(page.viewportSize()?.width).toBe(375);
    const bar = collectionBar(page);
    await expect(bar, 'X56c: the collection bar never rendered over eight games').toBeVisible({ timeout: 15_000 });

    // Colours only (computed values), read in one evaluate. The bar's fill and top rule are its
    // wrapper's; a game card is a bordered child of the grid the bar controls.
    const readColours = () =>
      bar.evaluate((el) => {
        const card = el.closest('.card');
        const wrap = el.parentElement;
        const grid = document.getElementById(el.getAttribute('aria-controls') ?? '');
        if (!card || !wrap || !grid) return null;
        const games = Array.from(grid.children).filter((child) => child.querySelector('h3'));
        const wrapStyle = getComputedStyle(wrap);
        return {
          ground: getComputedStyle(card).backgroundColor,
          bar: wrapStyle.backgroundColor,
          rule: wrapStyle.borderTopColor,
          ruleWidth: wrapStyle.borderTopWidth,
          words: getComputedStyle(el).color,
          cards: games.map((game) => {
            const style = getComputedStyle(game);
            return { fill: style.backgroundColor, edgeWidth: style.borderTopWidth };
          }),
        };
      });

    await assertTheme(page, 'dark');
    const dark = await readColours();
    expect(dark, 'X56c: the bar has no card around it or controls no grid').not.toBeNull();
    if (dark) {
      const read = JSON.stringify(dark);
      expect(dark.cards.length, `X56c: no game card was read (${read})`).toBeGreaterThanOrEqual(4);
      for (const game of dark.cards) {
        const apart = ratio(game.fill, dark.ground, 'X56c dark card fill against the card ground');
        // eslint-disable-next-line no-console -- the measured pair is recorded from the CI log (plan 88.9-68)
        if (game === dark.cards[0]) console.log(`[88.9-68 X56c] ${testInfo.project.name} dark: card fill ${game.fill} on ${dark.ground} = ${apart.toFixed(4)}`);
        expect(apart, `X56c: a dark card fill reads ${apart.toFixed(4)} from the card ground, under ${FILL_FLOOR} (${read})`).toBeGreaterThanOrEqual(FILL_FLOOR);
        expect(game.edgeWidth, `X56c: a dark card lost its 1px border (${read})`).toBe('1px');
      }
      const barApart = ratio(dark.bar, dark.ground, 'X52d dark bar against the card ground');
      const ruleApart = ratio(dark.rule, dark.bar, 'X52d dark top rule against the bar');
      const wordsOnBar = ratio(dark.words, dark.bar, 'X52d dark words on the bar');
      // eslint-disable-next-line no-console -- the measured pairs are recorded from the CI log (plan 88.9-68)
      console.log(`[88.9-68 X52d] ${testInfo.project.name} dark: bar ${barApart.toFixed(4)}, rule ${ruleApart.toFixed(4)}, words ${wordsOnBar.toFixed(4)}`);
      expect(barApart, `X52d: the dark bar reads ${barApart.toFixed(4)} from the card ground, under ${FILL_FLOOR} (${read})`).toBeGreaterThanOrEqual(FILL_FLOOR);
      expect(dark.ruleWidth, `X52d: the bar's top rule is not 1px (${read})`).toBe('1px');
      expect(ruleApart, `X52d: the dark top rule reads ${ruleApart.toFixed(4)} from the bar, under ${FILL_FLOOR} (${read})`).toBeGreaterThanOrEqual(FILL_FLOOR);
      expect(wordsOnBar, `X52d: the dark bar's words read ${wordsOnBar.toFixed(4)}, under ${TEXT_FLOOR} (${read})`).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }

    // Light: the cards keep no fill of their own; the bar still reads apart and its words pass.
    await forceLightMode(page);
    await page.reload();
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await assertTheme(page, 'light');
    const light = await readColours();
    expect(light, 'X56c: the light read found no card or grid').not.toBeNull();
    if (light) {
      const read = JSON.stringify(light);
      expect(light.cards.length, `X56c: no game card was read in light (${read})`).toBeGreaterThanOrEqual(4);
      for (const game of light.cards) {
        expect(game.fill, `X56c: a light card took a fill (${read})`).toBe('rgba(0, 0, 0, 0)');
        expect(game.edgeWidth, `X56c: a light card lost its 1px border (${read})`).toBe('1px');
      }
      const barApart = ratio(light.bar, light.ground, 'X52d light bar against the card ground');
      const wordsOnBar = ratio(light.words, light.bar, 'X52d light words on the bar');
      // eslint-disable-next-line no-console -- the measured pairs are recorded from the CI log (plan 88.9-68)
      console.log(`[88.9-68 X52d] ${testInfo.project.name} light: bar ${barApart.toFixed(4)}, words ${wordsOnBar.toFixed(4)}`);
      expect(barApart, `X52d: the light bar reads ${barApart.toFixed(4)} from the card ground, under ${FILL_FLOOR} (${read})`).toBeGreaterThanOrEqual(FILL_FLOOR);
      expect(light.ruleWidth, `X52d: the light bar's top rule is not 1px (${read})`).toBe('1px');
      expect(wordsOnBar, `X52d: the light bar's words read ${wordsOnBar.toFixed(4)}, under ${TEXT_FLOOR} (${read})`).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
  });
});
