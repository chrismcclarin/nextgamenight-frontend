import { test, expect, type Page } from '@playwright/test';

import { focusRingMeasurement } from './support/contrast';
import { expectHeldInside, expectWholeWords, readWordLines, setNarrowLargeText, TWO_WORD_NAME } from './support/wordLines';

/**
 * Phase 88.6.1-03 — Req 2 / AC-8: the suggestion card is a native button, at 375px.
 *
 * WHAT THIS ASSERTS THAT jsdom CANNOT. src/app/components/GameSuggestionCard.test.tsx pins the
 * role, the one accessible name, Enter and Space, and the class list. jsdom performs no layout and
 * applies no stylesheet, so none of that observes the RENDERED card. Turning a div into a native
 * button carries three visual risks a unit test is blind to: a button shrinks to its content
 * (the card must stay full-width), a button centres its text by default (the card must stay
 * left-aligned), and the new aria-hidden wrapper around the thumbnail could move or resize the
 * 64x64 dice tile. This spec measures each in a real engine at the iPhone SE viewport, plus the
 * focus ring the browser actually paints (read from computed style, never from the class list) and
 * a real browser's Enter on the focused card opening that game.
 *
 * NOT RUN LOCALLY — collection and typecheck are the only local proof. The `phone` project
 * depends on the `setup` project, which signs in through Auth0 with credentials that are
 * deliberately absent on a developer machine, and there is no `.auth/user.json` in the tree. CI's
 * `e2e` job runs it in the `phone` project on the phase PR.
 *
 * DECISION Phase 88.6.1-03 (fixture): the suggestions response is supplied by `page.route`,
 * chosen OVER seeding collection rows through a backend fixture (a cross-repo change, out of this
 * plan's scope, and the suggestions a real group gets depend on its members' collections) and
 * OVER driving the Browse Games dialog (plan 88.6.1-32 owns that dialog's phone spec). The event
 * page is reached through the existing `E2E_EVENT_DETAIL_PATH`, the same URL shape
 * `padding-budget.spec.ts` already runs green in this project: it carries an event_id and no
 * game_id, which is exactly the event-only view that renders the Recommended Games section. Both
 * games have no thumbnail, so the card draws its dice fallback, the path the tile assertions
 * measure. Replacing the route with real data is a decision, not a cleanup.
 *
 * Selector policy: role and name only, never a Tailwind class; DOM reads go through `evaluate`
 * on the located card. No screenshots, and no environment value is printed.
 */

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

const DICE = '\u{1F3B2}';

const GAME_A = {
  id: '8f1c2d3e-4a5b-4c6d-8e7f-901a2b3c4d5e',
  name: 'E2E Suggestion Catan',
  thumbnail_url: null,
  min_players: 3,
  max_players: 4,
  playing_time: 60,
  weight: 2.3,
  owners: ['Alice', 'Bob'],
  avg_group_rating: 4.2,
  review_count: 3,
};

// An 80-character unbroken name: it must stay inside the card, never widen the page.
// AMENDED 88.9-52 R4 D2 (owner 2026-11-18): it used to be cut to one line with an ellipsis; it is
// now shown in full, broken inside the word because that one word is wider than the whole card.
const GAME_B = {
  ...GAME_A,
  id: '9e2d3c4b-5a6f-4e7d-9c8b-a0b1c2d3e4f5',
  name: 'W'.repeat(80),
};

async function stubSuggestions(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/suggestions/event/'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({ json: { suggestions: [GAME_A, GAME_B], player_count: 4 } });
    },
  );
}

test.describe('GameSuggestionCard on the event page at 375px (88.6.1-03)', () => {
  // Runs ONLY in the `phone` project (the padding-budget.spec.ts shape): the claims here are
  // about a 375px viewport, and `journeys` collects every spec too, so this is a runtime skip.
  test.skip(({ isMobile }) => !isMobile, 'Req 2 phone arm: the layout claims are about a 375px viewport');

  test('Recommended Games card at 375px — a full-width, left-aligned button that keeps its dice tile (88.6.1-03)', async ({ page }) => {
    await stubSuggestions(page);
    await page.goto(E2E_EVENT_DETAIL_PATH);

    const card = page.getByRole('button', { name: GAME_A.name, exact: true });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();

    const m = await card.evaluate((el, dice) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const parent = el.parentElement as HTMLElement;
      const title = document.getElementById(el.getAttribute('aria-labelledby') ?? '') as HTMLElement;
      const titleRect = title.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(title);
      const textLeft = range.getBoundingClientRect().left;
      const wrapper = el.firstElementChild as HTMLElement;
      const tile = wrapper.firstElementChild as HTMLElement;
      const tileRect = tile.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        parentClientWidth: parent.clientWidth,
        innerWidth: window.innerWidth,
        textAlign: cs.textAlign,
        paddingLeft: Number.parseFloat(cs.paddingLeft),
        titleLeft: titleRect.left,
        textLeft,
        wrapperAriaHidden: wrapper.getAttribute('aria-hidden'),
        tileWidth: tileRect.width,
        tileHeight: tileRect.height,
        tileLeft: tileRect.left,
        tileHasDice: (tile.textContent ?? '').includes(dice),
      };
    }, DICE);

    // (i) a touch target, at least 44px tall.
    expect(m.height, `card height ${m.height}px`).toBeGreaterThanOrEqual(44);
    // (ii) inside the viewport.
    expect(m.right, `card right edge ${m.right} vs viewport ${m.innerWidth}`).toBeLessThanOrEqual(m.innerWidth);
    // (iii) full-width: a native button shrinks to its content unless told otherwise.
    expect(
      Math.abs(m.width - m.parentClientWidth),
      `card width ${m.width} vs parent clientWidth ${m.parentClientWidth}`,
    ).toBeLessThanOrEqual(1);
    // (iv) left-aligned: a native button centres its text by default.
    expect(m.textAlign, `card text-align ${m.textAlign}`).toBe('left');
    expect(
      Math.abs(m.textLeft - m.titleLeft),
      `title text starts at ${m.textLeft}, title box at ${m.titleLeft}`,
    ).toBeLessThanOrEqual(1);
    // (v) the hidden wrapper keeps the 64x64 dice tile at the card's padding edge.
    expect(m.wrapperAriaHidden, 'first child of the card is not the aria-hidden thumbnail wrapper').toBe('true');
    expect(Math.abs(m.tileWidth - 64), `tile width ${m.tileWidth}`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.tileHeight - 64), `tile height ${m.tileHeight}`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(m.tileLeft - (m.left + m.paddingLeft)),
      `tile left ${m.tileLeft} vs card left ${m.left} + padding ${m.paddingLeft}`,
    ).toBeLessThanOrEqual(1);
    expect(m.tileHasDice, 'the dice fallback icon is not drawn in the tile').toBe(true);

    // (vi) the 80-character name is shown in full inside its own card (88.9-52 R4 D2: no cut).
    const longCard = page.getByRole('button', { name: GAME_B.name, exact: true });
    await longCard.scrollIntoViewIfNeeded();
    const t = await longCard.evaluate((el) => {
      const title = document.getElementById(el.getAttribute('aria-labelledby') ?? '') as HTMLElement;
      return {
        textOverflow: getComputedStyle(title).textOverflow,
        scrollWidth: title.scrollWidth,
        clientWidth: title.clientWidth,
        titleRight: title.getBoundingClientRect().right,
        cardRight: el.getBoundingClientRect().right,
      };
    });
    expect(t.textOverflow, `title text-overflow ${t.textOverflow} (the title is still cut)`).not.toBe('ellipsis');
    expect(
      t.scrollWidth,
      `title scrollWidth ${t.scrollWidth} vs clientWidth ${t.clientWidth} (part of the name is outside its box)`,
    ).toBeLessThanOrEqual(t.clientWidth);
    expect(t.titleRight, `title right ${t.titleRight} vs card right ${t.cardRight}`).toBeLessThanOrEqual(t.cardRight);

    // (vii) no page-level horizontal scroll.
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      doc.scrollWidth,
      `document scrollWidth ${doc.scrollWidth} vs innerWidth ${doc.innerWidth}`,
    ).toBeLessThanOrEqual(doc.innerWidth);
  });

  // 88.9-52 R4 D2 (owner 2026-11-18: wrap, no line limit, and the name keeps its room; his worry: a
  // long name broken up too much to read, We/eke/nd W/arr/iors). The card cut its title and its
  // Owned by line to one line each beside the picture; both now wrap by whole words and the words
  // drop under the picture when they cannot share its line
  // (src/app/components/GameSuggestionCard.js ("AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the title wraps")).
  // The suggestions read is answered in the browser with one two-word game. At 375 with ordinary
  // text the words sit beside the picture. At 320 wide with the root text at 200% each word of the
  // title and of the Owned by line is on one line (or, for a word wider than the whole card, broken
  // only after the words have the card's full width), the picture keeps its 4rem square, and the
  // card holds everything. The page's own sideways scroll at this size is recorded in the log: the
  // rest of the event page at 320 / 200% is not this test's subject.
  // AMENDED Phase 89.6-18 (S2, owner "Drop", first look 2026-11-22; the Play history rule): at 320 /
  // 200% the picture is no longer drawn (its wrapper has no layout box); the 4rem square is read at
  // 375 with ordinary text, where it still sits beside the words.
  test('R4 D2 (88.9-52), S2 Drop (89.6-18): at 320 wide with 200% text the card keeps each word whole and its picture is dropped', async ({ page }) => {
    await page.route(
      (url) => url.pathname.startsWith('/api/suggestions/event/'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await route.fulfill({ json: { suggestions: [{ ...GAME_A, id: '7d3e4f5a-6b7c-4d8e-9f0a-b1c2d3e4f5a6', name: TWO_WORD_NAME }], player_count: 4 } });
      },
    );
    await page.goto(E2E_EVENT_DETAIL_PATH);
    const card = page.getByRole('button', { name: TWO_WORD_NAME, exact: true });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    const title = card.locator('span.font-bold', { hasText: TWO_WORD_NAME });
    const owners = card.locator('span', { hasText: /^Owned by / });
    const tile = () =>
      card.evaluate((el) => {
        const box = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const wrapper = el.firstElementChild as HTMLElement;
        const titleEl = document.getElementById(el.getAttribute('aria-labelledby') ?? '') as HTMLElement;
        return {
          card: box(el),
          tile: box(wrapper.firstElementChild as Element),
          pictureDisplay: getComputedStyle(wrapper).display,
          title: box(titleEl),
          rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
      });

    // Ordinary text at 375: the words are beside the picture, as before.
    const before = await tile();
    const beforeLine = JSON.stringify(before);
    expect(
      before.title.left >= before.tile.right && before.title.top < before.tile.bottom,
      `R4 D2: at ordinary text the title no longer sits beside the picture (${beforeLine})`,
    ).toBe(true);
    expectWholeWords(await readWordLines(title, card), ['Weekend', 'Warriors'], 'R4 D2 card title at ordinary text', { pageSideways: false });
    // At ordinary text the picture is drawn at its 4rem square (S2 drops it at large text only).
    expect(Math.abs(before.tile.width - 4 * before.rem), `S2: at ordinary text the picture is not 4rem wide (${beforeLine})`).toBeLessThanOrEqual(1);
    expect(Math.abs(before.tile.height - 4 * before.rem), `S2: at ordinary text the picture is not 4rem tall (${beforeLine})`).toBeLessThanOrEqual(1);

    await setNarrowLargeText(page, 'R4 D2 suggestion card');
    // The card is named as the row: a word may break only once the words have the card's whole width.
    const titleRead = await readWordLines(title, card);
    const ownersRead = await readWordLines(owners, card);
    const after = await tile();
    const afterLine = JSON.stringify(after);
    // eslint-disable-next-line no-console -- the measured card is recorded from the CI log
    console.log(`[88.9-52 R4 D2 suggestion card] 320 / 200%: ${JSON.stringify(titleRead)} ${JSON.stringify(ownersRead)} ${afterLine}`);
    expectWholeWords(titleRead, ['Weekend', 'Warriors'], 'R4 D2 card title at 320 / 200%', { pageSideways: false });
    expectWholeWords(ownersRead, ['Owned', 'by', 'Alice,', 'Bob'], 'R4 D2 Owned by line at 320 / 200%', { pageSideways: false });
    await expectHeldInside(card, 'R4 D2 suggestion card');
    // S2 Drop: the picture wrapper is not displayed (no layout box); the name is its text twin.
    expect(after.pictureDisplay, `S2: at 320 / 200% the picture is still drawn (${afterLine})`).toBe('none');
    expect(after.card.height, `R4 D2: the card is shorter than 44px (${afterLine})`).toBeGreaterThanOrEqual(44);
  });

  test('Recommended Games card — reached by keyboard it shows a focus ring, and Enter opens that game (88.6.1-03)', async ({ page }) => {
    await stubSuggestions(page);
    await page.goto(E2E_EVENT_DETAIL_PATH);

    const card = page.getByRole('button', { name: GAME_A.name, exact: true });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();

    // The resting card shadow first, so the focused read can be told apart from it.
    const resting = await card.evaluate((el) => getComputedStyle(el).boxShadow);

    // Reached by KEYBOARD (a Tab press, then focus), so :focus-visible applies. The helper throws
    // if the ring variables are empty, i.e. if the card never matched :focus-visible. jsdom applies
    // no stylesheet, so this ring is provable only here (e2e/contrast.spec.ts ("WHY THIS CANNOT BE A jsdom ARM")).
    const ring = await focusRingMeasurement(page, card, 'GameSuggestionCard focus ring (88.6.1-03)');
    await expect(card).toBeFocused();
    expect(ring.boxShadow, `focused box-shadow ${ring.boxShadow}`).not.toBe('none');
    expect(
      ring.boxShadow,
      `focused box-shadow ${ring.boxShadow} vs resting ${resting}`,
    ).not.toBe(resting);

    // A real browser's Enter on the focused native button opens that game. The group_id
    // parameter is deliberately not asserted: plan 88.6.1-25 changes where it comes from.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`game_id=${GAME_A.id}`), { timeout: 15_000 });
  });
});
