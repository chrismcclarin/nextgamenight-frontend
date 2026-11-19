import { test, expect } from '@playwright/test';
import { E2E_FAKE_GAME_ID, E2E_GAME_PATH, routeFakeGameSuccess } from './support/fakeGame';
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

// Plan 88.9-65 (owner fix row 52-X47, with 88.9-63's hand-off on this chip's pills): a past
// session's participant chip at 375px, read as layout in a real browser.
//
// THE OWNER'S QUESTION (at the 88.9-52 glance): "Why is it that some of the sessions have that odd
// pause between name and score but others don't? My name has the new player, but there's no pause,
// but my friend and my pending friend do?" The chip was a one-line flex row. When its pieces did
// not fit, a squeezed piece wrapped INSIDE itself (Score on one line, its number on the next) and
// kept the width of its longest line, which left the gap he saw. The fix makes the row wrap BY
// PIECE: a piece that does not fit moves to the next row whole.
//
// WHAT IT READS, in one evaluate after the row has rendered. For the Guest pill, the New Player
// pill, the faction pill, the Score piece and the placement piece: the number of text lines the
// piece's own words occupy (client rects of a range over its contents, grouped by line), which
// must be 1. The name is the one piece allowed to break (a long name wraps and is never cut).
// It also reads that the chip really has more than one row (so the one-line reads prove a wrap,
// not a chip that happened to fit), that no piece pokes out of the chip, that the page has no
// sideways scroll, and that the staged score 51.00 prints as Score: 51.
//
// HOW IT RUNS. Phone project only (375 x 667), CI only: the phone project needs the setup
// project's login state, which exists only in CI. The game is the shared fake custom game
// (e2e/support/fakeGame.ts ("export const E2E_FAKE_GAME_ID =")) on the real fixture group; the group's events read is
// answered in the browser with ONE staged past night, so the chip's content does not depend on
// seeded data. NO WRITES: nothing is pressed, every write is held in the browser, and the
// afterEach fails the test if one reached the hold. No capture option is set; failure messages
// carry px values and line counts only.

test.skip(({ isMobile }) => !isMobile, 'X47 (88.9-65): the chip wrap is a 375px read; the phone project owns it');

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const GROUP_EVENTS_PATH = new RegExp(`^/api/events/group/${E2E_GROUP_ID}$`);

// A name long enough that the pieces cannot share one row at 375px in either font stack.
const LONG_NAME = 'Bartholomew Featherstonehaugh-Montgomery';
const FACTION = 'Riverfolk Company';

const STAGED_NIGHT = {
  id: '0e2e0000-0000-4000-8000-000000000065',
  game_id: E2E_FAKE_GAME_ID,
  group_id: E2E_GROUP_ID,
  start_date: '2026-01-15T18:00:00Z',
  duration_minutes: 90,
  status: 'completed',
  comments: 'E2E staged night (88.9-65 X47)',
  EventParticipations: [
    {
      user_id: '0e2e0000-0000-4000-8000-0000000000a1',
      username: LONG_NAME,
      is_guest: true,
      is_custom: false,
      is_new_player: true,
      faction: FACTION,
      score: '51.00',
      placement: 1,
    },
  ],
};

let hold: WriteHold | undefined;

test.afterEach(async ({ page }) => {
  expectNoApiWrites(hold);
  hold = undefined;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('X47 (88.9-65): at 375 a session chip wraps by piece: no piece breaks inside itself, Score reads in one line, nothing overflows', async ({
  page,
}) => {
  hold = await holdWrites(page);
  await routeFakeGameSuccess(page);
  // The group's events read, answered in the browser with the one staged night.
  await page.route('**/api/events/group/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && GROUP_EVENTS_PATH.test(new URL(request.url()).pathname)) {
      await route.fulfill({ json: [STAGED_NIGHT] });
      return;
    }
    await route.fallback();
  });

  await page.goto(E2E_GAME_PATH);
  const main = page.getByRole('main');
  await expect(
    main.getByText(LONG_NAME, { exact: true }).first(),
    'X47: the staged night never rendered its participant (check the group events intercept)',
  ).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText(FACTION, { exact: true }).first(), 'X47: the faction piece never rendered').toBeVisible();

  const read = await page.evaluate(
    ({ name, faction }) => {
      const scope = document.querySelector('main');
      if (!scope) return { error: 'no main element' as const };
      const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

      // The chip: for every text node that holds exactly the name, the nearest ancestor that also
      // holds the Score piece; the SMALLEST such ancestor is the chip (the name may also print
      // elsewhere on the page). AMENDED 88.9-65 after CI runs 43760813851 and 43760817617: the first
      // shape tested a word boundary before Score, but an element's text runs its pieces together
      // with no space between them, so the chip was never found and the test failed on its own
      // lookup instead of on the chip. A plain substring test has no such edge.
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let nameEl: HTMLElement | null = null;
      let chip: HTMLElement | null = null;
      let namesSeen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (squash(node.nodeValue) !== name || !node.parentElement) continue;
        namesSeen += 1;
        let holder: HTMLElement | null = node.parentElement.parentElement;
        while (holder && holder !== scope && !(holder.textContent ?? '').includes('Score:')) holder = holder.parentElement;
        if (!holder || holder === scope) continue;
        if (!chip || holder.querySelectorAll('*').length < chip.querySelectorAll('*').length) {
          chip = holder;
          nameEl = node.parentElement;
        }
      }
      if (namesSeen === 0) return { error: 'name not found' as const };
      if (!chip || !nameEl) return { error: 'chip not found' as const };
      const chipEl = chip;

      // A piece: the DEEPEST element in the chip whose words match.
      const deepest = (matches: (text: string) => boolean): HTMLElement | null => {
        let found: HTMLElement | null = null;
        for (const el of Array.from(chipEl.querySelectorAll<HTMLElement>('*'))) {
          if (matches(squash(el.textContent))) found = el;
        }
        return found;
      };
      // The number of text lines an element's own words occupy.
      const linesOf = (el: HTMLElement): number => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set<number>();
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top));
        }
        return tops.size;
      };
      const boxOf = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };

      const wanted: Array<[string, (text: string) => boolean]> = [
        ['Guest', (text) => text === 'Guest'],
        ['New Player', (text) => text === 'New Player'],
        ['faction', (text) => text === faction],
        ['Score', (text) => /^Score: /.test(text)],
        ['placement', (text) => text === '#1'],
      ];
      const pieces = wanted.map(([label, matches]) => {
        const el = deepest(matches);
        return el
          ? { label, found: true as const, text: squash(el.textContent), lines: linesOf(el), box: boxOf(el) }
          : { label, found: false as const };
      });

      return {
        error: null,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        chip: boxOf(chipEl),
        nameLines: linesOf(nameEl),
        pieces,
      };
    },
    { name: LONG_NAME, faction: FACTION },
  );

  expect(read.error, `X47: the chip could not be read: ${read.error}`).toBeNull();
  if (read.error !== null) return;

  for (const piece of read.pieces) {
    expect(piece.found, `X47: the ${piece.label} piece is not in the chip`).toBe(true);
    if (!piece.found) continue;
    expect(
      piece.lines,
      `X47: the ${piece.label} piece breaks inside itself (its words occupy ${piece.lines} lines; a piece that does not fit must move to the next row whole)`,
    ).toBe(1);
    expect(
      piece.box.right,
      `X47: the ${piece.label} piece (right edge ${piece.box.right.toFixed(1)}px) pokes out of the chip (right edge ${read.chip.right.toFixed(1)}px)`,
    ).toBeLessThanOrEqual(read.chip.right + 0.5);
  }

  const score = read.pieces.find((piece) => piece.label === 'Score');
  expect(score?.found ? score.text : null, 'X47: the staged score 51.00 prints without its trailing zeros').toBe('Score: 51');

  // Anti-vacuity: the pieces sit on more than one row, so the chip really wrapped at this width.
  const centres = read.pieces
    .filter((piece) => piece.found)
    .map((piece) => (piece.found ? (piece.box.top + piece.box.bottom) / 2 : 0))
    .sort((a, b) => a - b);
  let rows = centres.length > 0 ? 1 : 0;
  for (let i = 1; i < centres.length; i += 1) {
    if (centres[i] - centres[i - 1] > 8) rows += 1;
  }
  expect(
    rows,
    `X47: the five pieces sit on ${rows} row(s) with the name on ${read.nameLines} line(s); the chip was expected to wrap at 375px, so this read would prove nothing`,
  ).toBeGreaterThanOrEqual(2);

  expect(
    read.chip.right,
    `X47: the chip's right edge (${read.chip.right.toFixed(1)}px) passes the viewport (${read.viewport}px)`,
  ).toBeLessThanOrEqual(read.viewport + 0.5);
  expect(
    read.scrollWidth,
    `X47: the page scrolls sideways at 375px (document ${read.scrollWidth}px against a ${read.viewport}px viewport)`,
  ).toBeLessThanOrEqual(read.viewport);
});
