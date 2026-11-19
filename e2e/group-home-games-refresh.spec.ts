// Phase 88.6.1-55 (Req 9, found while planning; D-09a / D-37 precedent; Req 5 focus correction) —
// group home games refresh at 375px in a real browser (the `phone` project, iPhone SE 375 x 667).
//
// What this proves that jsdom cannot: in a real browser at phone width, with React's real
// re-render and the house banner's real in-flight label, pressing "Try again" on the group's games
// banner keeps the whole page on screen while the retry is in flight. Before this plan every games
// refresh set the page-wide loader, so the page was replaced by "Loading games..." (and the
// banner, its busy Try again and the focused button went with it) until the request returned.
// The red half is GR-2 in src/app/groupHomePage/groupHomePage.identity.test.tsx (jsdom); GR-1,
// GR-3 and GR-4 there cover the event-created refresh, a group switch and newest-wins.
//
// It runs in CI only: the phone project needs the `.auth` storage state, which does not exist
// locally (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.
//
// Shared-fixture rules: the seeded group is shared with other specs, so this spec only READS.
// Every write is held in the browser by holdWrites (registered before navigation) and none is
// pressed; the games intercept touches GETs only. The first load's games GET is answered in the
// browser with one synthetic 500; the retry GET is held, then continued to the real backend
// unchanged. No response body is logged, printed or attached.
//
// DECISION Phase 88.6.1-55 (Req 9 phone arm): a spec-local fail-then-hold-then-continue route,
// chosen OVER the shared holdUntilReleased helper in e2e/support/inFlight.ts, which answers the
// held request in the browser with a JSON body; this spec must let the retry reach the real
// backend so the banner clears on a real answer. Changing this is a decision, not a cleanup.
import { test, expect, type Route } from '@playwright/test';

import { holdWrites } from './support/inFlight';
import { expectHeldInside, expectWholeWords, readWordLines, setNarrowLargeText, TWO_WORD_NAME } from './support/wordLines';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// GroupGamesList's banner title (existing copy, read only).
const GAMES_TITLE = "Couldn't load this group's games";

// The browser calls the same-origin BFF: `GET /api/lists/games/<group id>/<self uuid>?…`
// (src/lib/api.ts, getGroupGames).
const isGroupGamesRead = (url: URL) => url.pathname.includes(`/lists/games/${E2E_GROUP_ID}/`);

test.describe('group home games refresh — phone', () => {
  // Both projects glob every spec, so the guard is explicit.
  test.skip(
    ({ isMobile }) => !isMobile,
    'phone-project block — the fix is viewport-independent; jsdom GR-1..GR-4 cover the logic',
  );

  test.beforeEach(async ({ page }) => {
    await holdWrites(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Try again on the games banner keeps the group page on screen while the retry is in flight', async ({
    page,
  }) => {
    let mode: 'fail' | 'hold' | 'pass' = 'fail';
    let markArrived!: () => void;
    const arrived = new Promise<void>((resolve) => {
      markArrived = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Registered after holdWrites, so it runs first on a games read; any other method falls back
    // into the hold.
    await page.route(isGroupGamesRead, async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (mode === 'fail') {
        // Every games GET in this mode (robust to a duplicated first request).
        await route.fulfill({ status: 500, json: { code: 'internal', message: 'Simulated games failure' } });
        return;
      }
      if (mode === 'hold') {
        mode = 'pass';
        markArrived();
        await released;
        await route.continue();
        return;
      }
      await route.continue();
    });

    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    // D-11 dark-theme pre-assertion (the feedback-stacking.spec.ts idiom): the reused storage
    // state can carry a stored theme key, so assert the theme before anything visual.
    await expect(page.locator('html')).toHaveClass(/dark/);

    await expect(page.getByText(GAMES_TITLE, { exact: true })).toBeVisible({ timeout: 15_000 });
    const planLink = page.getByRole('link', { name: 'Plan Game Session' });
    await expect(planLink).toBeVisible();

    mode = 'hold';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await arrived;

    // The retry GET is in flight and held. POSITIVE first: the banner is still mounted, its Try
    // again busy — label kept, house spinner, named "Try again, retrying" (rule 1, 88.9-46 B38;
    // before 88.6.1-56 the page blanked and the banner was gone).
    const busy = page.getByRole('button', { name: /^Try again ?, retrying$/ });
    await expect(busy).toBeVisible();
    await expect(busy).toHaveText(/^Try again/);
    await expect(busy.locator('[data-slot="spinner"]')).toHaveCount(1);
    await expect(planLink).toBeVisible();
    await expect(page.getByText('Loading games...', { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'the group page scrolls sideways at 375px during the retry',
    ).toBe(true);

    release();
    await expect(page.getByText(GAMES_TITLE, { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // 88.9-52 round 4 (R4-A3), RENDERED. The round-3 capture found the group page scrolling sideways
  // by 14px at 320px with text at 200% (scrollWidth 334): in a play-history card the words column
  // is about 46px wide there, and the review count's last word ran past the card and the page
  // edge. The fix is one wrap box round the list
  // (src/app/groupHomePage/page.js ("DECISION Phase 88.9-52 (R4-A3, round-3 capture)")).
  // 200% is the root font size doubled by a style tag, the injection the capture used
  // (e2e/month-nav-row.spec.ts ("HOW 200% IS PRODUCED.")); it is not browser zoom.
  // READ-ONLY: writes are held by holdWrites and none is pressed. The games GET is answered in the
  // browser with ONE made-up game that has a rating and two reviews, so the line under test is on
  // screen whatever the shared group holds; the fields are the ones the card reads
  // (src/app/components/GroupGamesList.js ("{game.review_count === 1 ? 'review' : 'reviews'}")).
  // EXTENDED by 88.9-52 R4 C3 (owner 2026-11-18: "lose the picture at the large text"). The card is
  // a query container and its picture is not drawn while the card's inside is under 15rem
  // (src/app/components/GroupGamesList.js ("DECISION Phase 88.9-52 (R4 C3, owner 2026-11-18")), so
  // this test now also reads: at 375 and at 320 with ordinary text the picture IS drawn, 64px
  // square, left of the words; at 320 with text at 200% it is NOT drawn, the words start at the
  // card's inner edge, and no word is broken across two lines. The made-up game has no image, so
  // the picture here is the shared placeholder box, which takes the same class string as a real
  // image (src/app/components/SafeImage.js ("Applied to both img and fallback div")). The picture
  // is found by position (the first box in the card's row), never by a class. The title is kept.
  test('R4-A3 (88.9-52): at 320px with text at 200% a play-history card with a review count does not make the group page scroll sideways', async ({
    page,
  }) => {
    await page.route(isGroupGamesRead, async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        json: [
          {
            id: '00000000-0000-4000-8000-0000000000a3',
            name: 'Reflow',
            image_url: null,
            play_count: 3,
            last_played: '2026-01-15T18:00:00.000Z',
            avg_rating: 4.5,
            review_count: 2,
            theme: null,
            min_players: 2,
            max_players: 4,
          },
        ],
      });
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const reviews = page.getByText('(2 reviews)');
    await expect(reviews, 'R4-A3: the made-up game card with its review count did not render').toBeVisible({ timeout: 15_000 });

    // R4 C3: the card's picture and words, read in one pass.
    const readCard = () =>
      reviews.evaluate((el) => {
        const card = el.closest('a') as HTMLElement;
        const row = card.firstElementChild as HTMLElement;
        const picture = row.firstElementChild as HTMLElement;
        const words = row.lastElementChild as HTMLElement;
        const pictureBox = picture.getBoundingClientRect();
        const wordsBox = words.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        // A word is broken when one run of non-space characters in one text node sits on two lines.
        const broken: string[] = [];
        const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            const tops = new Set(
              Array.from(range.getClientRects())
                .filter((r) => r.width > 0)
                .map((r) => Math.round(r.top)),
            );
            if (tops.size > 1) broken.push(match[0]);
          }
        }
        return {
          sameRow: picture !== words && picture.parentElement === words.parentElement,
          pictureDrawn: picture.getClientRects().length > 0,
          pictureWidth: pictureBox.width,
          pictureHeight: pictureBox.height,
          pictureRight: pictureBox.right,
          wordsLeft: wordsBox.left,
          wordsWidth: wordsBox.width,
          cardInnerLeft: card.getBoundingClientRect().left + parseFloat(cardStyle.borderLeftWidth) + parseFloat(cardStyle.paddingLeft),
          cardInnerWidth: card.clientWidth - parseFloat(cardStyle.paddingLeft) - parseFloat(cardStyle.paddingRight),
          rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
          broken,
        };
      });
    const expectPictureDrawn = (card: Awaited<ReturnType<typeof readCard>>, at: string) => {
      expect(card.sameRow, `R4 C3 (${at}): the card's row does not hold a picture box and a words box`).toBe(true);
      expect(card.cardInnerWidth / card.rootPx, `R4 C3 (${at}): the card's inside is ${card.cardInnerWidth}px, under the 15rem switch, so this arm proves nothing`).toBeGreaterThanOrEqual(15);
      expect(card.pictureDrawn, `R4 C3 (${at}): the card's picture is not drawn although the card's inside is ${card.cardInnerWidth}px`).toBe(true);
      expect(Math.abs(card.pictureWidth - 64), `R4 C3 (${at}): the picture is ${card.pictureWidth}px wide, expected 64`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(card.pictureHeight - 64), `R4 C3 (${at}): the picture is ${card.pictureHeight}px tall, expected 64`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(card.wordsLeft - card.pictureRight - 16), `R4 C3 (${at}): the words start ${card.wordsLeft - card.pictureRight}px after the picture, expected 16`).toBeLessThanOrEqual(0.5);
      expect(card.wordsWidth, `R4 C3 (${at}): with the picture drawn the words column is ${card.wordsWidth}px, under 10rem`).toBeGreaterThanOrEqual(160);
      expect(card.broken, `R4 C3 (${at}): words broken across lines: ${card.broken.join(' ')}`).toEqual([]);
    };
    expectPictureDrawn(await readCard(), '375, ordinary text');

    await page.setViewportSize({ width: 320, height: 667 });
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.clientWidth), { message: 'R4-A3: the viewport did not become 320px wide' })
      .toBe(320);
    expectPictureDrawn(await readCard(), '320, ordinary text');

    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    await expect
      .poll(async () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)), {
        message: 'R4-A3: the root font size did not become 32px after the 200% style tag',
      })
      .toBe(32);
    await reviews.scrollIntoViewIfNeeded();

    // One read, after the layout has settled at 200%.
    const read = await reviews.evaluate((el) => {
      const rects = Array.from(el.getClientRects());
      const card = el.closest('a') as HTMLElement;
      return {
        viewport: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        wordsRight: Math.max(...rects.map((r) => r.right)),
        cardRight: card.getBoundingClientRect().right,
      };
    });
    expect(read.viewport, 'R4-A3: the viewport is not 320px wide').toBe(320);
    // R4 C3: no picture, the words take the card's full inner width, and every word is whole.
    const big = await readCard();
    expect(big.cardInnerWidth / big.rootPx, `R4 C3: at 320 / 200% the card's inside is ${big.cardInnerWidth}px, not under the 15rem switch, so this arm proves nothing`).toBeLessThan(15);
    expect(big.pictureDrawn, 'R4 C3: at 320px with text at 200% the card still draws its picture').toBe(false);
    expect(Math.abs(big.wordsLeft - big.cardInnerLeft), `R4 C3: at 320 / 200% the words start ${big.wordsLeft - big.cardInnerLeft}px in from the card's inner edge, expected 0`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(big.wordsWidth - big.cardInnerWidth), `R4 C3: at 320 / 200% the words column is ${big.wordsWidth}px of the card's ${big.cardInnerWidth}px`).toBeLessThanOrEqual(0.5);
    expect(big.broken, `R4 C3: at 320 / 200% these words are broken across lines: ${big.broken.join(' ')}`).toEqual([]);
    expect(
      read.wordsRight,
      `R4-A3: the review count ends at ${read.wordsRight}px, past its card's right edge at ${read.cardRight}px`,
    ).toBeLessThanOrEqual(read.cardRight + 0.5);
    expect(
      read.pageScrollWidth,
      `R4-A3: at 320px and 200% text the group page is ${read.pageScrollWidth}px wide — it scrolls sideways by ${read.pageScrollWidth - read.viewport}px`,
    ).toBeLessThanOrEqual(read.viewport);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // 88.9-52 R4 D2 (owner 2026-11-18: wrap, no line limit, and the name keeps its room; his worry: a
  // long name broken up too much to read, We/eke/nd W/arr/iors). A Library row cut its game name
  // and its facts line to one line each between the picture and the owner count; both now wrap by
  // whole words and the neighbours move
  // (src/app/components/GroupLibrary.js ("AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the game name wraps")).
  // The library read is answered in the browser with one two-word game (nothing is written). At
  // 375 with ordinary text the picture, the words and the count share one line. At 320 wide with
  // the root text at 200% each word of the name and of the facts line is on one line (or, for a
  // word wider than the whole row, broken only after the words have the row's full width), the
  // picture keeps its 2.5rem square, the owner count is whole on one line, and the row holds
  // everything. The page's own sideways scroll with the Library tab open at this size is recorded
  // in the log: the tab's search and filter controls at 320 / 200% are not this test's subject.
  test('R4 D2 (88.9-52): at 320 wide with 200% text a Library row keeps each word of a two-word game name and of its facts line whole, with the picture and the owner count whole', async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/library`),
      async (route: Route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        const owner = { user_id: '00000000-0000-4000-8000-0000000000d6', username: 'E2E Owner' };
        await route.fulfill({
          status: 200,
          json: {
            games: [
              {
                id: '00000000-0000-4000-8000-0000000000d2',
                name: TWO_WORD_NAME,
                thumbnail_url: null,
                image_url: null,
                min_players: 3,
                max_players: 4,
                playing_time: 60,
                weight: 2.3,
                owners: [owner],
              },
            ],
            members: [owner],
          },
        });
      },
    );

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const tab = page.getByRole('button', { name: 'Library', exact: true });
    await expect(tab, 'R4 D2: the Library tab never rendered').toBeVisible({ timeout: 15_000 });
    await tab.tap();
    const name = page.locator('p.font-bold', { hasText: TWO_WORD_NAME });
    await expect(name, 'R4 D2: the answered library game never rendered').toBeVisible({ timeout: 15_000 });
    const row = name.locator('xpath=ancestor::button[1]');
    const facts = row.locator('p', { hasText: 'players' });
    await row.scrollIntoViewIfNeeded();

    // The row's three parts: the picture (first child), the words column, the owner count (last).
    const parts = () =>
      row.evaluate((el) => {
        const box = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const count = el.lastElementChild as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(count);
        return {
          row: box(el),
          picture: box(el.firstElementChild as Element),
          words: box(el.children[1] as Element),
          count: box(count),
          countLines: new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size,
          rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
      });

    // Ordinary text at 375: one line, as before.
    const before = await parts();
    const beforeLine = JSON.stringify(before);
    expect(
      before.words.left >= before.picture.right && before.count.left >= before.words.right - 1 && before.count.top < before.picture.bottom && before.count.bottom > before.picture.top,
      `R4 D2: at ordinary text the picture, the words and the owner count no longer share one line (${beforeLine})`,
    ).toBe(true);
    expectWholeWords(await readWordLines(name, row), ['Weekend', 'Warriors'], 'R4 D2 library name at ordinary text', { pageSideways: false });

    await setNarrowLargeText(page, 'R4 D2 library row');
    await row.scrollIntoViewIfNeeded();
    // The row is named: a word may break only once the words have the row's whole width.
    const nameRead = await readWordLines(name, row);
    const factsRead = await readWordLines(facts, row);
    const after = await parts();
    const afterLine = JSON.stringify(after);
    // eslint-disable-next-line no-console -- the measured row is recorded from the CI log
    console.log(`[88.9-52 R4 D2 library row] 320 / 200%: ${JSON.stringify(nameRead)} ${JSON.stringify(factsRead)} ${afterLine}`);
    expectWholeWords(nameRead, ['Weekend', 'Warriors'], 'R4 D2 library name at 320 / 200%', { pageSideways: false });
    expectWholeWords(factsRead, null, 'R4 D2 library facts line at 320 / 200%', { pageSideways: false });
    await expectHeldInside(row, 'R4 D2 library row');
    // The neighbours moved, they did not shrink or break: a 2.5rem picture and a one-line count.
    expect(Math.abs(after.picture.width - 2.5 * after.rem), `R4 D2: the picture is not 2.5rem wide (${afterLine})`).toBeLessThanOrEqual(1);
    expect(Math.abs(after.picture.height - 2.5 * after.rem), `R4 D2: the picture is not 2.5rem tall (${afterLine})`).toBeLessThanOrEqual(1);
    expect(after.countLines, `R4 D2: the owner count is on ${after.countLines} lines (${afterLine})`).toBe(1);
    expect(after.row.height, `R4 D2: the row is shorter than 44px (${afterLine})`).toBeGreaterThanOrEqual(44);
  });
});
