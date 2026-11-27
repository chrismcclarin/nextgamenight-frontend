// Surface rows: the group page, one row per part of the page (census R07). Owner: plan 89.6-17;
// the Library rows and the check-in cards (R08-checkins, on the planning page) are plan 89.6-42's.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE GROUP READ. Every enforced row answers the group's own read through the one group-read answer
// (e2e/support/groupRead.ts ("export async function routeGroupRead")): the real row with a group
// icon staged (a picture or an emoji), so the title row's icon is on screen whatever the seed holds.
// The page's role and membership checks still read the real row. Nothing on the page is pressed,
// and the sweep's guard holds every write all the same.
//
// THE ROOT is the page's main.
import { expect, type Page } from '@playwright/test';

import { compositeGround, contrastRatio, probeElement } from '../contrast';
import { GROUP_ICON_EMOJI, GROUP_ICON_PICTURE, routeGroupRead, type GroupRow } from '../groupRead';
import { settleAnimations } from '../inFlight';
import { PLANNING_CREATOR_A_ID, PLANNING_CREATOR_B_ID, PLANNING_POLL_A_ID, PLANNING_POLL_B_ID, routePlanningPolls, syntheticPlanningPoll } from '../planningPolls';
import { THIRTY_LETTER_WORD, TWO_WORD_NAME } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';
import { emptySettingsAnswers } from './planning';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id, as in e2e/support/largeTextSurfaces/members.ts ("No fallback id").
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the group rows open that group');
  return id;
};

// The play-history read (src/lib/api.ts, getGroupGames): GET /api/lists/games/<group id>/<self uuid>.
const isGamesRead = (url: URL): boolean => url.pathname.includes(`/lists/games/${groupId()}/`);

type Transform = (group: GroupRow) => GroupRow;
const withIcon =
  (icon: string): Transform =>
  (group) => ({ ...group, profile_picture_url: icon });

// One group-read route per page: the sweep runs a reach again on the same page for the light cell,
// and a page's routes outlive its navigations.
const routed = new WeakSet<Page>();

/** Open the group page with the group read staged, and wait for its title. */
async function openGroup(page: Page, transform: Transform): Promise<{ root: ReturnType<Page['locator']> }> {
  if (!routed.has(page)) {
    await routeGroupRead(page, groupId(), transform);
    routed.add(page);
  }
  await page.goto(`/groupHomePage?id=${groupId()}`);
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 15_000 });
  const root = page.locator('main');
  await settleAnimations(root);
  return { root };
}

// R07-long (UI-SPEC E5 long-text): the group name made of the 30-letter word and two short words,
// with the picture icon. The 30-letter word may break only because it alone is wider than its row.
const LONG_NAME = `${THIRTY_LETTER_WORD} Weekend Warriors`;
const reachLong: SurfaceRow['reach'] = (page) => openGroup(page, (group) => ({ ...group, name: LONG_NAME, profile_picture_url: GROUP_ICON_PICTURE }));

// R07-games: the Overview with the picture icon; the play-history read answered empty (its rows are
// R07-history's), so this row also shows the No game nights logged yet state (EMPTY_STATES).
const reachGames: SurfaceRow['reach'] = (page) => openGroup(page, withIcon(GROUP_ICON_PICTURE));
// R07-emoji: the same with the emoji icon.
const reachEmoji: SurfaceRow['reach'] = (page) => openGroup(page, withIcon(GROUP_ICON_EMOJI));
const answerNoGames = (url: URL): unknown => (isGamesRead(url) ? [] : undefined);

// THE PLAY HISTORY ROWS (UI-SPEC E4 and the E3 sort row). R07-history answers the games read with
// three made-up games (the fields the card reads, as e2e/group-home-games-refresh.spec.ts ("R4-A3 (88.9-52)")
// answers it): a two-word name, one with no image, one with two reviews. R07-history-error answers
// it 500 and R07-history-loading holds it: each registers its own route in reach, after the guard,
// once per page. The held read is ANSWERED when the page closes, never handed on or unrouted (an
// unroute hands every held request on to the network: the 88.9-03 incident; plan 89.6-16's D01-busy).
const PLAYED = (id: string, name: string, extra: Record<string, unknown>) => ({
  id,
  name,
  image_url: null,
  play_count: 3,
  last_played: '2026-01-15T18:00:00.000Z',
  avg_rating: null,
  review_count: 0,
  theme: null,
  min_players: 2,
  max_players: 4,
  ...extra,
});
const THREE_GAMES = [
  PLAYED('00000000-0000-4000-8000-0000000017a1', TWO_WORD_NAME, { image_url: '/logo.svg', theme: 'Strategy' }),
  PLAYED('00000000-0000-4000-8000-0000000017a2', 'Reflow', { play_count: 1 }),
  PLAYED('00000000-0000-4000-8000-0000000017a3', 'Carcassonne', { avg_rating: 4.5, review_count: 2, theme: 'Tile placement' }),
];
const answerThreeGames = (url: URL): unknown => (isGamesRead(url) ? THREE_GAMES : undefined);

/** The Play history section: the box that holds its level-2 heading. */
async function playHistory(page: Page): Promise<{ root: ReturnType<Page['locator']> }> {
  const heading = page.getByRole('heading', { level: 2, name: 'Play history', exact: true });
  await heading.waitFor({ state: 'visible', timeout: 15_000 });
  const root = heading.locator('xpath=..');
  await settleAnimations(root);
  return { root };
}

// R07-history: three games; the root is the section (its sort row, select and cards).
const reachHistory: SurfaceRow['reach'] = async (page) => {
  await openGroup(page, withIcon(GROUP_ICON_PICTURE));
  await page.getByText('(2 reviews)').first().waitFor({ state: 'visible', timeout: 15_000 });
  return playHistory(page);
};

// R07-history-error: the games read answered 500; the section shows its banner with Try again.
const erroring = new WeakSet<Page>();
const reachHistoryError: SurfaceRow['reach'] = async (page) => {
  if (!erroring.has(page)) {
    await page.route(isGamesRead, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { code: 'internal', message: 'Simulated games failure' } });
    });
    erroring.add(page);
  }
  await openGroup(page, withIcon(GROUP_ICON_PICTURE));
  await page.getByRole('button', { name: 'Try again', exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  return playHistory(page);
};

// R07-history-loading: the games read held, so the page shows its loading line (the first games
// load holds the whole page); the root is the page's main.
const holding = new WeakSet<Page>();
const reachHistoryLoading: SurfaceRow['reach'] = async (page) => {
  if (!holding.has(page)) {
    const release = new Promise<void>((resolve) => page.once('close', () => resolve()));
    await page.route(isGamesRead, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await release;
      await route.fulfill({ status: 500 }).catch(() => undefined);
    });
    holding.add(page);
  }
  if (!routed.has(page)) {
    await routeGroupRead(page, groupId(), withIcon(GROUP_ICON_PICTURE));
    routed.add(page);
  }
  await page.goto(`/groupHomePage?id=${groupId()}`);
  const root = page.locator('main');
  await root.getByText('Loading games...', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(root);
  return { root };
};

// The title row's icon (src/app/groupHomePage/page.js ("DECISION Phase 89.6-17 (title-icon)")): not
// drawn while the title row is narrower than picture, gaps, a 7.5rem title and the 44px gear. The
// product's own threshold, as that marker states it: 13rem + 44px below the md step, 14.5rem + 44px
// from it, against the WIDTH OF THE TITLE ROW (a container query on the row).
// AMENDED Phase 89.6-17 (R17, 2026-11-26): the expectation follows that threshold. It was
// "drawn from 768 wide", written when every cell under 768 was at 200% text or a page-zoom width;
// the 320 x 568 normal-text cell (R16) has a 264px row against a 252px threshold, so the icon is
// drawn there and that is the product rule, not a defect. The numbers are written HERE, not read
// from the icon's class: a changed threshold in the page must red this row.
//   - rem: the cell's text size. A container query reads rem from the root's own font size: 16px at
//     normal text and at the page-zoom widths, 32px at 200% and at a default font of 32.
//   - the md step is a media query, and a media query reads rem from the browser's DEFAULT font
//     size: 768px, and 1536px in the default-font-32 cell (where 768 wide is below md).
//   - the row's width is read in the page (it is the cell's width less the page's own edges).
// Found by position (the element before the h1's column), never by a class.
const ICON_DROPS_UNDER = { belowMd: { rem: 13, px: 44 }, fromMd: { rem: 14.5, px: 44 } } as const;
const iconThresholdIn = (cell: SweepCell): { px: number; said: string } => {
  const rem = cell.mode === '100' ? 16 : 32;
  const mdFrom = 48 * (cell.mode === 'font32' ? 32 : 16);
  const step = cell.width >= mdFrom ? ICON_DROPS_UNDER.fromMd : ICON_DROPS_UNDER.belowMd;
  return { px: step.rem * rem + step.px, said: `${step.rem}rem at ${rem}px + ${step.px}px` };
};
const titleRowExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const icon = await page.getByRole('heading', { level: 1 }).evaluate((h1) => {
    const box = h1.parentElement?.previousElementSibling ?? null;
    const row = h1.parentElement?.parentElement ?? null;
    return { present: box !== null, drawn: box !== null && box.getClientRects().length > 0, rowWidth: row ? row.getBoundingClientRect().width : null };
  });
  const threshold = iconThresholdIn(cell);
  expect(icon.rowWidth, `title-icon: in ${cell.id} the title row has no box to measure`).not.toBeNull();
  const rowWidth = icon.rowWidth ?? 0;
  expect(
    { present: icon.present, drawn: icon.drawn },
    `title-icon: in ${cell.id} the group icon box is ${icon.present ? (icon.drawn ? 'drawn' : 'not drawn') : 'absent'}; the title row is ${rowWidth}px and the icon drops under ${threshold.px}px (${threshold.said})`,
  ).toEqual({
    present: true,
    drawn: rowWidth >= threshold.px,
  });
};

// The Group settings gear (owner picks O-9b = B and O-M4 = Fixed+): its box is held at 44 x 44 in
// every cell (within 0.5px) and its cog follows the text up to 32px. The CI login owns the group, so
// the gear is on screen.
const gearExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const gear = page.getByRole('button', { name: 'Group settings', exact: true });
  const read = await gear.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const svg = el.querySelector('svg')?.getBoundingClientRect() ?? null;
    return { width: box.width, height: box.height, svg: svg ? Math.max(svg.width, svg.height) : null };
  });
  const line = `${cell.id}: gear ${read.width} x ${read.height}, cog ${read.svg}`;
  expect(Math.abs(read.width - 44) <= 0.5 && Math.abs(read.height - 44) <= 0.5, `O-M4: the gear box is not 44 x 44 (${line})`).toBe(true);
  expect(read.svg !== null && read.svg <= 32.5, `O-M4: the gear cog is missing or over 32px (${line})`).toBe(true);
};
// The tab strip (CI-01g, the group half) and its selected underline (the U1 floor):
//   - dark cells: the selected tab's underline against the ground below the strip clears 3.0;
//   - every cell: the strip's scroll box is no wider than its parent, and when its tabs overflow an
//     aria-hidden fade is on at the hidden end; then, with the strip at its start, the second tab
//     focused by keyboard (Tab from the first) is covered by a visible fade for at most
//     max(0, tabWidth - (stripWidth - 2 * fadeWidth)) + 0.5 px (review M027 / M115).
// The strip's scroll and the focus are put back for the cells after this one.
const stripExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const main = page.locator('main');
  const overview = main.getByRole('button', { name: 'Overview', exact: true });
  const library = main.getByRole('button', { name: 'Library', exact: true });
  const strip = overview.locator('xpath=..');
  const line = strip.locator('xpath=..');
  if (cell.theme === 'dark') {
    const underline = await overview.evaluate((el) => getComputedStyle(el).borderBottomColor);
    const ground = compositeGround(await probeElement(line));
    const ratio = ground === null ? null : contrastRatio(underline, ground);
    expect(ratio !== null && ratio >= 3.0, `tab-edge: in ${cell.id} the selected tab's underline ${underline} on ${ground} measures ${ratio?.toFixed(4)}, floor 3.0`).toBe(true);
  }
  const geo = await strip.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    parent: (el.parentElement as HTMLElement).getBoundingClientRect().width,
    overflow: el.scrollWidth > el.clientWidth + 1,
  }));
  expect(geo.width <= geo.parent + 0.5, `tab-strip: in ${cell.id} the tab box is ${geo.width}px in a ${geo.parent}px strip`).toBe(true);
  if (!geo.overflow) return;
  await strip.evaluate((el) => el.scrollTo({ left: 0 }));
  await expect(line.locator('[aria-hidden="true"][data-strip-cue="end"]'), `tab-strip: in ${cell.id} the tabs overflow and no end fade shows`).toBeVisible();
  await overview.focus();
  await page.keyboard.press('Tab');
  await expect(library, `tab-strip: in ${cell.id} Tab from Overview did not reach Library`).toBeFocused();
  const covered = () =>
    library.evaluate((tab) => {
      const t = tab.getBoundingClientRect();
      const box = (tab.parentElement as HTMLElement).getBoundingClientRect();
      const fade = 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cues = Array.from((tab.parentElement as HTMLElement).parentElement!.querySelectorAll('[data-strip-cue]'))
        .map((cue) => cue.getBoundingClientRect())
        .filter((r) => r.width > 0);
      const cover = cues.reduce((sum, r) => sum + Math.max(0, Math.min(t.right, r.right) - Math.max(t.left, r.left)), 0);
      return { cover, allowed: Math.max(0, t.width - (box.width - 2 * fade)) + 0.5 };
    });
  // Two animation frames first, then poll: the focus handler's scroll lands on the next frame.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect
    .poll(async () => {
      const read = await covered();
      return read.cover <= read.allowed ? 'clear' : `${read.cover.toFixed(1)}px under a fade, allowed ${read.allowed.toFixed(1)}`;
    }, { message: `tab-strip: in ${cell.id} the keyboard-focused Library tab sits under a fade`, timeout: 3_000 })
    .toBe('clear');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await strip.evaluate((el) => el.scrollTo({ left: 0 }));
};

const headerExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  await titleRowExtras(page, cell);
  await gearExtras(page, cell);
  await stripExtras(page, cell);
};

// R08-CHECKINS (census R08; owner pick S3 = Rules, 2026-11-22). The check-in cards mount only on the
// planning page (src/app/components/PromptScheduleSection.js ("<OpenPollsList")), so the row that
// plan 89.6-17 left here as R07-checkins is census R08: renamed, never doubled. Three open polls
// are staged through the one planning helper (e2e/support/planningPolls.ts ("export async function routePlanningPolls(")),
// and the group read gains their two games (the card's title is the poll's game name):
//   - poll A, the active one (so its card is the SELECTED card): the two-word title;
//   - poll B: no game, so the generic title Availability check-in;
//   - poll C: a game named with the 30-letter word.
// Each carries can_close, so every card draws its three dots. Nothing is pressed (End check-in is a
// write); the Check-ins panel is left expanded, the page default. The root is the list of cards.
const S3_GAME_SHORT = '89642000-0000-4000-8000-0000000000e1';
const S3_GAME_LONG = '89642000-0000-4000-8000-0000000000e2';
const S3_POLL_C_ID = '89642000-0000-4000-8000-0000000000a3';
const GENERIC_TITLE = 'Availability check-in';
const S3_POLLS = [
  { ...syntheticPlanningPoll(PLANNING_POLL_A_ID, 'E2E Ana', PLANNING_CREATOR_A_ID), game_id: S3_GAME_SHORT, can_close: true },
  { ...syntheticPlanningPoll(PLANNING_POLL_B_ID, 'E2E Ben', PLANNING_CREATOR_B_ID), can_close: true },
  { ...syntheticPlanningPoll(S3_POLL_C_ID, 'E2E Cleo', PLANNING_CREATOR_A_ID), game_id: S3_GAME_LONG, can_close: true },
];
const withCheckInGames: Transform = (group) => ({
  ...group,
  games: [...(Array.isArray(group.games) ? group.games : []), { id: S3_GAME_SHORT, name: TWO_WORD_NAME }, { id: S3_GAME_LONG, name: THIRTY_LETTER_WORD }],
});
const checkInTriggers = (page: Page) => page.getByRole('button', { name: 'Check-in actions', exact: true });
const planningRouted = new WeakSet<Page>();
export const reachCheckIns: NonNullable<SurfaceRow['reach']> = async (page) => {
  if (!planningRouted.has(page)) {
    planningRouted.add(page);
    await routeGroupRead(page, groupId(), withCheckInGames);
    await routePlanningPolls(page, { groupId: groupId(), polls: S3_POLLS, activeId: PLANNING_POLL_A_ID, respondents: [] });
  }
  await page.goto(`/groupPlanning?group_id=${groupId()}`);
  await expect(checkInTriggers(page)).toHaveCount(3, { timeout: 15_000 });
  await page.getByText(TWO_WORD_NAME, { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  const root = checkInTriggers(page).first().locator('xpath=ancestor::ul[1]');
  await settleAnimations(root);
  return { root };
};

// R08-checkins extras (S3 = Rules: 'the dots stay beside the title wherever they fit; where they do
// not fit, they drop under the words at the right with no empty band'). In every cell, every card:
//   - BESIDE: the three-dot trigger starts at or after the body's right edge and above the bottom of
//     the title; or
//   - WRAPPED: the trigger's top is within 1px of the bottom of the body's last line (no band) and
//     its right edge sits 13px inside the card (1px border + the 12px card edge, or 2px + 11px on
//     the selected card), within 0.5px. The 13 is written HERE, never read from a class.
//   - the trigger's box is 44 x 44 within 0.5px (O-M4 Fixed+, plan 89.6-26: the premise of the pick).
// With 200% text at 320 and 375 wide the two-word title's card is BESIDE. The word Availability is
// on one line wherever the card's body has room for it (it alone wider than the body is the read's
// own wide case, never a squeeze). One joined line is thrown, so a failure fails the cell; every
// cell prints its reading on one line, since a green CI run uploads nothing.
const TRIGGER_INSET = 13;
const checkInsExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const cards = await checkInTriggers(page).evaluateAll((triggers) =>
    triggers.map((trigger) => {
      const li = trigger.closest('li');
      const body = li?.firstElementChild ?? null;
      const title = body ? (Array.from(body.children).find((child) => child.getAttribute('aria-hidden') !== 'true') ?? null) : null;
      const last = body?.lastElementChild ?? null;
      if (!li || !body || !title || !last) return null;
      const t = trigger.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const text = title.firstChild;
      const words: { word: string; lines: number; width: number }[] = [];
      if (text && text.nodeType === Node.TEXT_NODE) {
        for (const match of (text.textContent ?? '').matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, match.index ?? 0);
          range.setEnd(text, (match.index ?? 0) + match[0].length);
          const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
          words.push({ word: match[0], lines: new Set(rects.map((rect) => Math.round(rect.top))).size, width: rects.reduce((sum, rect) => sum + rect.width, 0) });
        }
      }
      const bodyStyle = getComputedStyle(body);
      return {
        title: (title.textContent ?? '').trim(),
        beside: t.left >= b.right - 1 && t.top < title.getBoundingClientRect().bottom,
        band: t.top - last.getBoundingClientRect().bottom,
        inset: li.getBoundingClientRect().right - t.right,
        width: t.width,
        height: t.height,
        room: b.width - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight),
        words,
      };
    }),
  );
  const problems: string[] = [];
  const said: string[] = [];
  if (cards.length !== 3) problems.push(`${cards.length} check-in cards, not 3`);
  for (const card of cards) {
    if (card === null) {
      problems.push('a three-dot trigger sits in no card with a body and a title');
      continue;
    }
    const name = card.title === THIRTY_LETTER_WORD ? '30-letter' : card.title;
    said.push(`"${name}" ${card.beside ? 'beside' : `wrapped, band ${card.band.toFixed(1)}, inset ${card.inset.toFixed(1)}`}, dots ${card.width.toFixed(1)} x ${card.height.toFixed(1)}`);
    if (Math.abs(card.width - 44) > 0.5 || Math.abs(card.height - 44) > 0.5) problems.push(`"${name}": the three-dot box is ${card.width.toFixed(1)} x ${card.height.toFixed(1)}, not 44 x 44`);
    if (!card.beside) {
      if (Math.abs(card.band) > 1) problems.push(`"${name}": the dots sit under the words with a ${card.band.toFixed(1)}px band (S3: no empty band)`);
      if (Math.abs(card.inset - TRIGGER_INSET) > 0.5) problems.push(`"${name}": the wrapped dots end ${card.inset.toFixed(1)}px inside the card, not ${TRIGGER_INSET}`);
    }
    if (card.title === TWO_WORD_NAME && cell.mode === '200' && cell.width <= 375 && !card.beside) problems.push(`"${name}": the dots are not beside the title in ${cell.id} (S3: beside wherever they fit)`);
    for (const word of card.words) {
      if (word.word === 'Availability' && word.lines !== 1 && word.width <= card.room + 0.5) problems.push(`"${name}": Availability is on ${word.lines} lines with ${card.room.toFixed(1)}px of room for its ${word.width.toFixed(1)}px`);
    }
  }
  process.stdout.write(`S3 recorded: R08-checkins ${cell.id}: ${said.join(' | ')}\n`);
  if (problems.length > 0) throw new Error(`S3: in ${cell.id}: ${problems.join('; ')}`);
};

// THE LIBRARY ROWS (census R07; UI-SPEC E4, the Library half; owner first look 2026-11-22: S2 = Drop).
// The Library tab's own read (src/lib/api.ts ("getGroupLibrary: (group_id: string) =>"): GET
// /groups/<group id>/library) is answered in the browser with three made-up games and four members:
//   - the two-word name, no picture, its facts line, four owners, one named with the 30-letter word;
//   - a game named with the 30-letter word, with a picture, one owner;
//   - Azul, two owners.
// The play-history read is answered empty (its rows are R07-history's). The only thing pressed is the
// Library tab (a tab: no write). The root is the page's main.
const isLibraryRead = (url: URL): boolean => url.pathname.endsWith(`/groups/${groupId()}/library`);
const LIBRARY_OWNER = (n: number, username: string) => ({ user_id: `89642000-0000-4000-8000-0000000000b${n}`, username });
const LIBRARY_OWNERS = [LIBRARY_OWNER(1, 'E2E Owner'), LIBRARY_OWNER(2, THIRTY_LETTER_WORD), LIBRARY_OWNER(3, 'E2E Ben'), LIBRARY_OWNER(4, 'E2E Cleo')];
const LIBRARY_GAME = (n: number, name: string, extra: Record<string, unknown>) => ({
  id: `89642000-0000-4000-8000-0000000000c${n}`,
  name,
  thumbnail_url: null,
  image_url: null,
  min_players: null,
  max_players: null,
  playing_time: null,
  weight: null,
  ...extra,
});
const LIBRARY = {
  games: [
    LIBRARY_GAME(1, TWO_WORD_NAME, { min_players: 3, max_players: 4, playing_time: 60, weight: 2.3, owners: LIBRARY_OWNERS }),
    LIBRARY_GAME(2, THIRTY_LETTER_WORD, { thumbnail_url: '/logo.svg', owners: [LIBRARY_OWNERS[0]] }),
    LIBRARY_GAME(3, 'Azul', { owners: [LIBRARY_OWNERS[2], LIBRARY_OWNERS[3]] }),
  ],
  members: LIBRARY_OWNERS,
};
const answerLibrary = (url: URL): unknown => (isLibraryRead(url) ? LIBRARY : answerNoGames(url));
const answerEmptyLibrary = (url: URL): unknown => (isLibraryRead(url) ? { games: [], members: [] } : answerNoGames(url));

/** Open the group page, press the Library tab, and wait for what the tab shows. */
async function openLibrary(page: Page, shown: (root: ReturnType<Page['locator']>) => ReturnType<Page['locator']>): Promise<{ root: ReturnType<Page['locator']> }> {
  const { root } = await openGroup(page, withIcon(GROUP_ICON_PICTURE));
  await root.getByRole('button', { name: 'Library', exact: true }).click();
  await shown(root).first().waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(root);
  return { root };
}
// A Library row is the button that holds a game's name line (the tabs and the owner chips hold none).
const libraryRows = (page: Page) => page.locator('main').locator('button:has(> div > p)');
const reachLibrary: SurfaceRow['reach'] = (page) => openLibrary(page, (root) => root.getByText(TWO_WORD_NAME, { exact: true }));
// R07-library-empty (EMPTY_STATES: This library is empty): the same read answered with no games; the
// Add games link is never pressed.
const reachLibraryEmpty: SurfaceRow['reach'] = (page) => openLibrary(page, (root) => root.getByText('This library is empty', { exact: true }));
// R07-library-open (UI-SPEC E4 overflow and long-text): the two-word game's row opened (a row
// button: no write), so its four owners (one named with the 30-letter word, the fourth behind the
// more-owners button) and View game are on screen. The root is that game's card.
const openRow = (page: Page) => libraryRows(page).filter({ hasText: TWO_WORD_NAME });
const reachLibraryOpen: SurfaceRow['reach'] = async (page) => {
  await openLibrary(page, (root) => root.getByText(TWO_WORD_NAME, { exact: true }));
  const row = openRow(page);
  await row.click();
  const card = row.locator('xpath=..');
  // The reveal is the box after the row button: it has a height once the row is open.
  await expect.poll(() => row.evaluate((button) => button.nextElementSibling?.getBoundingClientRect().height ?? 0), { message: 'R07-library-open: the row did not open', timeout: 5_000 }).toBeGreaterThan(0);
  await settleAnimations(card);
  return { root: card };
};

// R07-library extras (S2 = Drop: at large text the Library row's picture is not drawn; the game name
// beside it is its text twin). The product's own threshold, written HERE and never read from a class:
// the picture is drawn only while the row's inside is over 13.25rem (picture 2.5rem + gap 0.75rem +
// a 10rem words column), rem being the root's own text size (a container query). So it is NOT drawn
// with 200% text at 320 and 375 wide and at the two page-zoom widths, and it IS drawn at 768 wide
// (200% and default font 32) and at 320 with normal text. Every cell prints its reading on one line,
// since a green CI run uploads nothing; one joined line is thrown, so a failure fails the cell.
const PICTURE_DROPS_AT_REM = 13.25;
const pictureDrawnIn = (cell: SweepCell): boolean => cell.width >= 768 || (cell.mode === '100' && !cell.zoom);
const libraryExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const read = await libraryRows(page).evaluateAll((buttons) =>
    buttons.map((button) => {
      const style = getComputedStyle(button);
      const picture = button.firstElementChild;
      return {
        name: (button.querySelector('p')?.textContent ?? '').trim(),
        drawn: picture !== null && picture.getClientRects().length > 0,
        inside: button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
    }),
  );
  const problems: string[] = [];
  const said: string[] = [];
  if (read.length !== 3) problems.push(`${read.length} Library rows, not 3`);
  for (const row of read) {
    const name = row.name === THIRTY_LETTER_WORD ? '30-letter' : row.name;
    const threshold = PICTURE_DROPS_AT_REM * row.rem;
    said.push(`"${name}" picture ${row.drawn ? 'drawn' : 'not drawn'}, inside ${row.inside.toFixed(1)} of ${threshold.toFixed(1)}`);
    if (row.drawn !== pictureDrawnIn(cell)) problems.push(`"${name}": the picture is ${row.drawn ? 'drawn' : 'not drawn'} in ${cell.id} (S2: drawn only at 768 wide and at 320 with normal text)`);
    if (row.inside > threshold !== pictureDrawnIn(cell)) problems.push(`"${name}": the row's inside is ${row.inside.toFixed(1)}px against ${threshold.toFixed(1)}px (${PICTURE_DROPS_AT_REM}rem at ${row.rem}px), so this cell does not prove the drop it is listed for`);
  }
  // A closed row says so (WCAG 4.1.2): its button reads aria-expanded false.
  const expanded = await libraryRows(page).first().getAttribute('aria-expanded');
  if (expanded !== 'false') problems.push(`the first (closed) Library row's button reads aria-expanded ${expanded === null ? 'not set' : expanded}, not false`);
  if (cell.id === '320x568-dark-200') {
    // 89.6-42: Tab skips a closed Library row
    const scrollY = await page.evaluate(() => window.scrollY);
    await libraryRows(page).first().focus();
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const rowButtons = Array.from(document.querySelectorAll('main button')).filter((button) => button.querySelector(':scope > div > p'));
      return { second: el !== null && el === rowButtons[1], what: el ? `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"` : 'nothing' };
    });
    said.push(`Tab from the first row lands on ${landed.what}`);
    if (!landed.second) problems.push(`Tab from the first (closed) Library row lands on ${landed.what}, not on the second row: a closed row's hidden control takes the keyboard focus`);
    await page.evaluate((y) => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, y);
    }, scrollY);
  }
  process.stdout.write(`S2 recorded: R07-library ${cell.id}: ${said.join(' | ')}\n`);
  if (problems.length > 0) throw new Error(`S2: in ${cell.id}: ${problems.join('; ')}`);
};

// R07-library-open extras: the opened row's button reads aria-expanded true in every cell; in the
// 320 x 568 200% cell, Tab from that button walks the opened row's own controls, View game among
// them, before it leaves the card (they are in the keyboard order once the row is open).
const libraryOpenExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const problems: string[] = [];
  const row = openRow(page);
  const expanded = await row.getAttribute('aria-expanded');
  if (expanded !== 'true') problems.push(`the opened Library row's button reads aria-expanded ${expanded === null ? 'not set' : expanded}, not true`);
  let walked: string[] = [];
  if (cell.id === '320x568-dark-200') {
    const scrollY = await page.evaluate(() => window.scrollY);
    await row.focus();
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      const at = await row.evaluate((button) => {
        const el = document.activeElement as HTMLElement | null;
        const reveal = button.nextElementSibling;
        return { inside: el !== null && reveal !== null && reveal.contains(el), text: el ? (el.textContent ?? '').trim().slice(0, 30) : '' };
      });
      if (!at.inside) break;
      walked.push(at.text);
    }
    if (!walked.includes('View game')) problems.push(`Tab from the opened row's button walked [${walked.join(', ')}] and never reached View game`);
    await page.evaluate((y) => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, y);
    }, scrollY);
  } else walked = ['not read in this cell'];
  process.stdout.write(`library-open recorded: R07-library-open ${cell.id}: aria-expanded ${expanded}; Tab walks [${walked.join(', ')}]\n`);
  if (problems.length > 0) throw new Error(`library-open: in ${cell.id}: ${problems.join('; ')}`);
};

export const rows: SurfaceRow[] = [
  { id: 'R07-games', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', reach: reachGames, answers: answerNoGames, extras: headerExtras },
  { id: 'R07-emoji', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', state: 'emoji icon', reach: reachEmoji, answers: answerNoGames, extras: headerExtras },
  { id: 'R07-long', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', state: 'long name', reach: reachLong, answers: answerNoGames, extras: headerExtras },
  { id: 'R07-library', census: 'R07', kind: 'route', owner: '89.6-42', status: 'enforced', state: 'the Library tab: three games, a 30-letter game name, a 30-letter member name', reach: reachLibrary, answers: answerLibrary, extras: libraryExtras },
  { id: 'R07-library-empty', census: 'R07', kind: 'route', owner: '89.6-42', status: 'enforced', state: 'empty library', reach: reachLibraryEmpty, answers: answerEmptyLibrary },
  { id: 'R07-library-open', census: 'R07', kind: 'route', owner: '89.6-42', status: 'enforced', state: 'a Library row opened, a 30-letter owner name', reach: reachLibraryOpen, answers: answerLibrary, extras: libraryOpenExtras },
  { id: 'R08-checkins', census: 'R08', kind: 'route', owner: '89.6-42', status: 'enforced', state: 'three check-in cards: short title beside the dots, generic title, 30-letter title', reach: reachCheckIns, answers: emptySettingsAnswers, extras: checkInsExtras },
  { id: 'R07-history', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', reach: reachHistory, answers: answerThreeGames },
  { id: 'R07-history-error', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', state: 'games read failed', reach: reachHistoryError },
  { id: 'R07-history-loading', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', state: 'games read loading', reach: reachHistoryLoading },
];
