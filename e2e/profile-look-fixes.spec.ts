import { test, expect, type Locator, type Page } from '@playwright/test';

import { assertTheme, contrastRatio, focusByKeyboard, forceLightMode } from './support/contrast';
import { expectNoApiWrites, holdUntilReleased, holdWrites, type WriteHold } from './support/inFlight';

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

// One game card's x, found by its place (the button in the title row of that game's card), never
// by its words: its name changes while it counts down, while it is live and while it removes.
function removeIn(page: Page, gameName: string): Locator {
  return collectionCard(page)
    .getByRole('heading', { level: 3, name: gameName, exact: true })
    .locator('xpath=../..')
    .getByRole('button');
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface XRead {
  button: Box;
  /** The one visible bordered box inside the button, or null when the button has no element child. */
  box: (Box & { scrollWidth: number; clientWidth: number; edge: string }) | null;
  /** The X icon inside the box, or null. */
  icon: { width: number; height: number } | null;
  /** The slot around the button (the grid that holds the armed width), or null. */
  slot: Box | null;
  /** The game's title beside the x. */
  title: Box | null;
  /** The spinner's untransformed box (it rotates, so its centre and layout size are read), or null. */
  spinner: Box | null;
}

// Every box of one x, read in ONE evaluate so they belong to one layout.
function readX(remove: Locator): Promise<XRead> {
  return remove.evaluate((el) => {
    const rect = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const boxEl = el.firstElementChild as HTMLElement | null;
    const iconEl = boxEl?.querySelector('svg') ?? null;
    const slotEl = el.closest('span.inline-grid');
    const titleEl = el.parentElement?.closest('div.border')?.querySelector('h3') ?? null;
    const spinEl = el.querySelector<HTMLElement>('[data-slot="spinner"]');
    let spinner = null;
    if (spinEl) {
      const r = spinEl.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const w = spinEl.offsetWidth;
      const h = spinEl.offsetHeight;
      spinner = { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2, width: w, height: h };
    }
    return {
      button: rect(el),
      box: boxEl
        ? {
            ...rect(boxEl),
            scrollWidth: boxEl.scrollWidth,
            clientWidth: boxEl.clientWidth,
            edge: getComputedStyle(boxEl).borderTopWidth,
          }
        : null,
      icon: iconEl ? { width: iconEl.getBoundingClientRect().width, height: iconEl.getBoundingClientRect().height } : null,
      slot: slotEl && !el.contains(slotEl) ? rect(slotEl) : null,
      title: titleEl ? rect(titleEl) : null,
      spinner,
    };
  });
}

function expectSameBox(now: Box | null, before: Box | null, what: string): void {
  expect(now && before, `${what}: a box could not be read`).toBeTruthy();
  if (!now || !before) return;
  const read = `${JSON.stringify(before)} then ${JSON.stringify(now)}`;
  for (const side of ['left', 'top', 'right', 'bottom'] as const) {
    expect(Math.abs(now[side] - before[side]), `${what}: its ${side} edge moved (${read})`).toBeLessThanOrEqual(0.5);
  }
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

  // X53 (owner at N37): the x was a large box with a small glyph. Now the BUTTON is the 44px hit
  // area and holds one small bordered box with the dialog's 20px X; the armed width is reserved on
  // a slot around the button, so the title beside it never moves. Then X36a: with the removal held,
  // the spinner sits inside that box. The DELETE is held in the browser and answered in the browser
  // in finally (a held request is sent on when the routes are removed).
  test('X53 (88.9-68): at rest the x is a small box with a 20px X in a 44px hit area, and arming it leaves the game title where it was', async ({ page }, testInfo) => {
    backstop = await openProfileWithEightGames(page);
    const del = await holdUntilReleased(page, 'DELETE', /\/user-games\/user\/[^/]+\/game\/e2e-shelf-a$/);
    try {
      if (testInfo.project.name === 'phone') expect(page.viewportSize()?.width).toBe(375);
      const remove = removeIn(page, NAMES[0]);
      await expect(remove, 'X53: the first game card never rendered its x').toBeVisible({ timeout: 15_000 });
      await expect(remove).toHaveAccessibleName(`Remove ${NAMES[0]}`);

      // At rest.
      const rest = await readX(remove);
      const restRead = JSON.stringify(rest);
      // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 88.9-68)
      console.log(`[88.9-68 X53] ${testInfo.project.name} rest: ${restRead}`);
      expect(rest.button.width, `X53: the hit area is under 44px wide (${restRead})`).toBeGreaterThanOrEqual(44);
      expect(rest.button.height, `X53: the hit area is under 44px tall (${restRead})`).toBeGreaterThanOrEqual(44);
      expect(rest.icon, `X53: the x holds no X icon (${restRead})`).not.toBeNull();
      expect(rest.icon?.width, `X53: the X icon is not 20px wide (${restRead})`).toBe(20);
      expect(rest.icon?.height, `X53: the X icon is not 20px tall (${restRead})`).toBe(20);
      expect(rest.box, `X53: the x holds no visible box (${restRead})`).not.toBeNull();
      expect(rest.box?.edge, `X53: the box has no 1px border (${restRead})`).toBe('1px');
      expect(rest.box?.width ?? 99, `X53: the resting box is wider than 32px (${restRead})`).toBeLessThanOrEqual(32.5);
      expect(rest.box?.height ?? 99, `X53: the resting box is taller than 32px (${restRead})`).toBeLessThanOrEqual(32.5);
      expect(rest.slot, `X53: no slot around the button holds the armed width (${restRead})`).not.toBeNull();
      if (rest.slot) {
        expect(Math.abs(rest.slot.right - rest.button.right), `X53: the button is not at its slot's right edge (${restRead})`).toBeLessThanOrEqual(1);
      }

      // One press arms it: the title stays where it was, and nothing is sent.
      await focusByKeyboard(page, remove);
      await page.keyboard.press('Enter');
      await expect(remove).toHaveAttribute('aria-pressed', 'true');
      const armed = await readX(remove);
      // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 88.9-68)
      console.log(`[88.9-68 X53] ${testInfo.project.name} armed: ${JSON.stringify(armed)}`);
      expectSameBox(armed.title, rest.title, 'X53: the game title after arming');
      expectSameBox(armed.slot, rest.slot, 'X53: the slot after arming');
      expect(del.count(), 'X53: one press sent a removal').toBe(0);

      // The second live press commits; the DELETE is held. X36a: the spinner shows inside the box.
      await expect(remove, 'X53: the armed x never went live').toHaveAccessibleName('Remove', { timeout: 10_000 });
      await page.keyboard.press('Enter');
      await del.arrived;
      await expect(remove.locator('[data-slot="spinner"]'), 'X36a: no spinner showed while the removal was held').toBeVisible({ timeout: 5_000 });
      await expect(remove).toHaveAttribute('aria-disabled', 'true');
      await expect(remove).toHaveAccessibleName(`Remove ${NAMES[0]}, removing`);
      const held = await readX(remove);
      const heldRead = JSON.stringify(held);
      // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 88.9-68)
      console.log(`[88.9-68 X36a] ${testInfo.project.name} held: ${heldRead}`);
      expect(held.box && held.spinner, `X36a: the held x has no box or no spinner (${heldRead})`).toBeTruthy();
      if (held.box && held.spinner) {
        expect(held.spinner.left, `X36a: the spinner starts left of the box (${heldRead})`).toBeGreaterThanOrEqual(held.box.left - 0.5);
        expect(held.spinner.right, `X36a: the spinner ends right of the box (${heldRead})`).toBeLessThanOrEqual(held.box.right + 0.5);
        expect(held.spinner.top, `X36a: the spinner starts above the box (${heldRead})`).toBeGreaterThanOrEqual(held.box.top - 0.5);
        expect(held.spinner.bottom, `X36a: the spinner ends below the box (${heldRead})`).toBeLessThanOrEqual(held.box.bottom + 0.5);
        expect(held.box.scrollWidth, `X36a: the box's content overflows it (${heldRead})`).toBeLessThanOrEqual(held.box.clientWidth);
      }
      expectSameBox(held.title, rest.title, 'X36a: the game title while the removal is held');
      expectSameBox(held.slot, rest.slot, 'X36a: the slot while the removal is held');
      expect(del.count(), 'X36a: two live presses sent more than one removal').toBe(1);

      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, 'X53: horizontal overflow on the collection card').toBe(true);
    } finally {
      // Answered in the browser, never handed on.
      await del.release({ message: 'Game removed from your collection' });
    }
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

  // X54 (owner at N37): the tab strip showed a scroll bar that could not scroll. The strip scrolls
  // sideways by design (never wraps), and a box that scrolls on one axis scrolls on the other too,
  // so anything taller than the strip's own box gives it a vertical range. Read here: no vertical
  // range, one line, the active tab's 2px underline inside the strip, and the keyboard ring drawn
  // inside the strip (an outset ring is clipped by the same box).
  test("X54 (88.9-68): the Availability tab strip has nothing to scroll vertically, keeps one line with overflow-x auto, shows the active tab's whole 2px underline, and draws a keyboard-focused tab's ring inside the strip", async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    await page.goto('/userProfile');
    if (testInfo.project.name === 'phone') expect(page.viewportSize()?.width).toBe(375);
    const list = page.getByRole('tablist', { name: 'Availability settings' });
    await expect(list, 'X54: the Availability tab strip never rendered').toBeVisible({ timeout: 15_000 });

    const strip = await list.evaluate((el) => {
      const style = getComputedStyle(el);
      const tabs = Array.from(el.querySelectorAll('[role="tab"]'));
      const box = el.getBoundingClientRect();
      const active = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowX: style.overflowX,
        tops: tabs.map((tab) => tab.getBoundingClientRect().top),
        // The bottom of the strip's own content box: where a child stops being visible.
        innerBottom: box.top + el.clientTop + el.clientHeight,
        activeBottom: active ? active.getBoundingClientRect().bottom : null,
        activeUnderline: active ? getComputedStyle(active).borderBottomWidth : null,
      };
    });
    const read = JSON.stringify(strip);
    // eslint-disable-next-line no-console -- the measured strip is recorded from the CI log (plan 88.9-68)
    console.log(`[88.9-68 X54] ${testInfo.project.name}: ${read}`);
    expect(strip.scrollHeight, `X54: the strip has a vertical scroll range (${read})`).toBe(strip.clientHeight);
    expect(strip.overflowX, `X54: the strip no longer scrolls sideways (${read})`).toBe('auto');
    expect(strip.tops.length, `X54: the strip has fewer than two tabs (${read})`).toBeGreaterThanOrEqual(2);
    expect(Math.max(...strip.tops) - Math.min(...strip.tops), `X54: the tabs are not on one line (${read})`).toBeLessThanOrEqual(0.5);
    expect(strip.activeUnderline, `X54: the active tab's underline is not 2px (${read})`).toBe('2px');
    expect(strip.activeBottom, `X54: no active tab was read (${read})`).not.toBeNull();
    expect(strip.activeBottom ?? 0, `X54: the active tab's underline runs below the strip's box (${read})`).toBeLessThanOrEqual(strip.innerBottom + 0.5);

    // A keyboard-focused tab draws its ring inside its own box, where the strip cannot clip it.
    const first = list.getByRole('tab').first();
    await focusByKeyboard(page, first);
    await expect(first).toBeFocused();
    const ring = await first.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring, `X54: the focused tab's ring is not inset (${ring})`).toContain('inset');
  });

  // X55 (owner at N37): a small "Remind me:" beside a large select. The select cannot shrink on a
  // phone (16px so iOS does not zoom, 44px to tap), so the label rises to the form-label size.
  test('X55 (88.9-68): Remind me: reads at 14px beside the 16px select, centred on it, and on a phone the select keeps 44px', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    await page.goto('/userProfile');
    const phone = testInfo.project.name === 'phone';
    if (phone) expect(page.viewportSize()?.width).toBe(375);
    const select = page.getByRole('combobox', { name: 'Remind me', exact: true });
    await expect(select, 'X55: the reminder select never rendered').toBeVisible({ timeout: 15_000 });

    const row = await select.evaluate((el) => {
      const label = el.parentElement?.querySelector('span') ?? null;
      if (!label) return null;
      // Primary ink, resolved through a throwaway probe beside the label.
      const probe = document.createElement('span');
      probe.className = 'text-content-primary';
      label.insertAdjacentElement('afterend', probe);
      const primary = getComputedStyle(probe).color;
      probe.remove();
      const l = label.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      const labelStyle = getComputedStyle(label);
      return {
        words: (label.textContent ?? '').trim(),
        labelSize: labelStyle.fontSize,
        labelInk: labelStyle.color,
        primary,
        selectSize: getComputedStyle(el).fontSize,
        selectHeight: s.height,
        centres: Math.abs((l.top + l.bottom) / 2 - (s.top + s.bottom) / 2),
      };
    });
    expect(row, 'X55: no label sits beside the reminder select').not.toBeNull();
    if (row) {
      const read = JSON.stringify(row);
      // eslint-disable-next-line no-console -- the measured row is recorded from the CI log (plan 88.9-68)
      console.log(`[88.9-68 X55] ${testInfo.project.name}: ${read}`);
      expect(row.words).toBe('Remind me:');
      expect(row.labelSize, `X55: the label is not 14px (${read})`).toBe('14px');
      expect(row.labelInk, `X55: the label is not in primary ink (${read})`).toBe(row.primary);
      expect(row.selectSize, `X55: the select is not 16px (${read})`).toBe('16px');
      expect(row.centres, `X55: the label is not centred on the select (${read})`).toBeLessThanOrEqual(1);
      if (phone) {
        expect(row.selectHeight, `X55: on a phone the select is under 44px tall (${read})`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  // X57 (owner at N48): the check mark mounted only on the pressed Theme button, so both labels
  // moved a little at every switch. Each label's place is read from its own text (a Range rect),
  // relative to the pair's box so a scroll between reads changes nothing. The theme is stored on
  // the device only (no request), and it is switched back before the test ends.
  test('X57 (88.9-68): switching theme leaves both Theme button labels exactly where they were', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    await page.goto('/userProfile');
    if (testInfo.project.name === 'phone') expect(page.viewportSize()?.width).toBe(375);
    const light = page.getByRole('button', { name: 'Light', exact: true });
    const dark = page.getByRole('button', { name: 'Dark', exact: true });
    await expect(light, 'X57: the Theme pair never rendered').toBeVisible({ timeout: 15_000 });
    await light.scrollIntoViewIfNeeded();

    const readLabels = () =>
      light.evaluate((el) => {
        const pair = el.parentElement;
        if (!pair) return null;
        const origin = pair.getBoundingClientRect();
        const out: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
        for (const button of Array.from(pair.querySelectorAll('button'))) {
          const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const words = (node.textContent ?? '').trim();
            if (words !== 'Light' && words !== 'Dark') continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const r = range.getBoundingClientRect();
            out[words] = { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
          }
        }
        return out;
      });
    const moved = (
      now: Record<string, { left: number; top: number; right: number; bottom: number }> | null,
      before: Record<string, { left: number; top: number; right: number; bottom: number }> | null,
      when: string,
    ) => {
      expect(now && before, `X57: the labels could not be read ${when}`).toBeTruthy();
      if (!now || !before) return;
      const read = `${JSON.stringify(before)} then ${JSON.stringify(now)}`;
      for (const name of ['Light', 'Dark']) {
        expect(now[name] && before[name], `X57: no ${name} label was read ${when} (${read})`).toBeTruthy();
        for (const side of ['left', 'top', 'right', 'bottom'] as const) {
          expect(Math.abs(now[name][side] - before[name][side]), `X57: the ${name} label's ${side} edge moved ${when} (${read})`).toBeLessThanOrEqual(0.5);
        }
      }
    };

    const startedDark = (await dark.getAttribute('aria-pressed')) === 'true';
    const other = startedDark ? light : dark;
    const original = startedDark ? dark : light;
    const before = await readLabels();
    // eslint-disable-next-line no-console -- the measured labels are recorded from the CI log (plan 88.9-68)
    console.log(`[88.9-68 X57] ${testInfo.project.name} before: ${JSON.stringify(before)}`);

    await other.click();
    await expect(other).toHaveAttribute('aria-pressed', 'true');
    await expect(original).toHaveAttribute('aria-pressed', 'false');
    const switched = await readLabels();
    // eslint-disable-next-line no-console -- the measured labels are recorded from the CI log (plan 88.9-68)
    console.log(`[88.9-68 X57] ${testInfo.project.name} switched: ${JSON.stringify(switched)}`);

    // Back to the theme the test started in, before any assertion can end the test.
    await original.click();
    await expect(original).toHaveAttribute('aria-pressed', 'true');
    const restored = await readLabels();

    moved(switched, before, 'after the switch');
    moved(restored, before, 'after switching back');
  });
});
