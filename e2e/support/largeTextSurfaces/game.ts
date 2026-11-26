// Surface rows: the game page (the game view of census R05) and the two review dialogs. Owner: plan 89.6-29.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// WHAT IS STAGED (stageGame). The game view of the shared fake game id, answered in the browser as a
// BoardGameGeek game with a long two-part name, no picture (the placeholder draws) and a description
// long enough to overflow its three-line clamp. The group's events read is three past sessions of
// that game: durations 150 minutes, 45 minutes and none; a member winner, a typed-in guest winner
// and a group win; one comment; participants with every pill the card draws (Guest, New Player, a
// faction, Score, placement), a guest with an account among them. Each session names the group, so
// the breadcrumb's group crumb reads the two-word name. The reviews read is three reviews: the
// viewer's own (4.5 stars, recommended, a two-line text), a 42-letter hyphenated name (5 stars,
// recommended) and a short name (3 stars). The group's members read is the real roster with every
// member an owner, so the session's three-dot menu (Edit and Delete from md up) shows.
//
// EVERY ANSWER IS IN THE BROWSER. A staged row exists only in the answer sent to the browser, its id
// is in no database, and nothing is written (the sweep's guard holds every write, and sends the self
// read on without its timezone parameter). No reach presses a control that writes.
//
// WHAT A ROW PRINTS. CI keeps nothing from a passing browser test, so the normal-text boxes of
// R05-game are printed as one ZZ29 line per width. The phase reads those lines with
// execute/ci-log.sh in the planning folder.
import type { Locator, Page } from '@playwright/test';

import { E2E_FAKE_GAME_ID, routeFakeGameSuccess } from '../fakeGame';
import { settleAnimations } from '../inFlight';
import { routeMemberRoster } from '../memberRoster';
import { TWO_WORD_NAME } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';
import { LONG_NAME, SHORT_GUEST, everyMemberAnOwner, groupId, onGet, uuid } from './night';

export const GAME_NAME = 'Twilight Imperium: Fourth Edition';
const gamePath = (): string => `/gameDetail?game_id=${E2E_FAKE_GAME_ID}&group_id=${groupId()}`;

// About 600 characters, so the phone clamp (three lines) overflows at every width and Show More draws.
const DESCRIPTION =
  'Twilight Imperium is a game of galactic conquest in which three to six players take on the role of one of seventeen factions vying for galactic domination through military might, political maneuvering, and economic bargaining. ' +
  'Every faction offers a completely different play experience, from the wormhole-hopping Ghosts of Creuss to the Emirates of Hacan, masters of trade and economics. ' +
  'These seventeen races are offered many paths to victory, but only one may sit upon the throne of Mecatol Rex as the new masters of the galaxy. ' +
  'No two games are ever the same, and a full game fills an afternoon and most of an evening.';

const bggGame = () => ({
  id: E2E_FAKE_GAME_ID,
  name: GAME_NAME,
  is_custom: false,
  bgg_id: 233078,
  theme: null,
  image_url: null,
  year_published: 2017,
  min_players: 3,
  max_players: 6,
  playing_time: 240,
  description: DESCRIPTION,
});

// Fixed dates (never relative to today), so the same words are measured in every run.
const session = (n: number, start: string, more: Record<string, unknown>) => ({
  id: uuid(`5e551${n}`),
  group_id: groupId(),
  game_id: E2E_FAKE_GAME_ID,
  start_date: start,
  status: 'completed',
  is_group_win: false,
  comments: null,
  Winner: null,
  Group: { id: groupId(), name: TWO_WORD_NAME },
  ...more,
});
const SESSIONS = () => [
  session(1, '2026-09-12T19:00:00.000Z', {
    duration_minutes: 150,
    Winner: { id: uuid('e4'), username: 'Alice', is_custom: false },
    comments: 'Six players, the full galaxy. We stopped at ten points.',
    EventParticipations: [
      { id: uuid('b1'), user_id: uuid('e4'), username: 'Alice', is_guest: false, is_custom: false, score: 10, placement: 1, faction: 'The Emirates of Hacan' },
      { id: uuid('b2'), user_id: uuid('e2'), username: LONG_NAME, is_guest: true, is_custom: false, score: 8, placement: 2 },
      { id: uuid('b3'), user_id: null, username: TWO_WORD_NAME, is_guest: true, is_custom: true, score: 7, placement: 3 },
      { id: uuid('b4'), user_id: uuid('e7'), username: 'Dan', is_guest: false, is_custom: false, is_new_player: true, faction: 'The Ghosts of Creuss' },
    ],
  }),
  session(2, '2026-06-27T19:00:00.000Z', {
    duration_minutes: 45,
    Winner: { id: null, username: TWO_WORD_NAME, is_custom: true },
    EventParticipations: [
      { id: uuid('b5'), user_id: null, username: TWO_WORD_NAME, is_guest: true, is_custom: true },
      { id: uuid('b6'), user_id: uuid('e3'), username: SHORT_GUEST, is_guest: true, is_custom: false },
    ],
  }),
  session(3, '2025-12-27T19:00:00.000Z', {
    duration_minutes: null,
    is_group_win: true,
    EventParticipations: [
      { id: uuid('b7'), user_id: uuid('e5'), username: 'Bob', is_guest: false, is_custom: false },
      { id: uuid('b8'), user_id: uuid('e6'), username: 'Carol', is_guest: false, is_custom: false },
    ],
  }),
];

const review = (n: number, userId: string, username: string, rating: string, more: Record<string, unknown>) => ({
  id: uuid(`7e71e${n}`),
  game_id: E2E_FAKE_GAME_ID,
  group_id: groupId(),
  user_id: userId,
  rating,
  is_recommended: false,
  review_text: null,
  createdAt: '2026-09-13T18:00:00.000Z',
  updatedAt: '2026-09-13T18:00:00.000Z',
  User: { id: userId, username },
  ...more,
});
// The viewer's own review is keyed on the id the page itself sends (the reviews read carries the
// resolved self id as user_id), so it is the viewer's in CI and on any seed.
const REVIEWS = (selfId: string | null, own: boolean) => [
  ...(own && selfId
    ? [review(1, selfId, 'Alice', '4.5', { is_recommended: true, review_text: 'Long, loud and worth the whole day.\nBring snacks and a second table.' })]
    : []),
  review(2, uuid('e2'), LONG_NAME, '5.0', { is_recommended: true, review_text: 'The best negotiation game we own.', createdAt: '2026-06-28T18:00:00.000Z' }),
  review(3, uuid('e3'), SHORT_GUEST, '3.0', { review_text: 'Too long for a weeknight.', createdAt: '2025-12-28T18:00:00.000Z' }),
];

export interface GameStaging {
  /** The viewer's own review among the three (default true). False: Add Review shows instead. */
  ownReview?: boolean;
  /** The three past sessions (default true). False: the events read answers an empty list. */
  sessions?: boolean;
  /** The reviews (default true). False: the reviews read answers an empty list. */
  reviews?: boolean;
}

// One set of routes per page: the sweep runs a reach again on the same page for the light cell, and
// a page's routes outlive its navigations.
const staged = new WeakSet<Page>();

/** Register the game view's staged reads on the page (once), after the sweep's guard. */
export async function stageGame(page: Page, staging: GameStaging = {}): Promise<void> {
  if (staged.has(page)) return;
  staged.add(page);
  const { ownReview = true, sessions = true, reviews = true } = staging;
  await routeMemberRoster(page, groupId(), everyMemberAnOwner);
  // The shared fake game (e2e/support/fakeGame.ts ("DECISION Phase 88.9-36 (refactor-on-touch)")): its game read is answered here as a BoardGameGeek game.
  await routeFakeGameSuccess(page, {
    onGameGet: async (route) => {
      await route.fulfill({ json: bggGame() });
      return true;
    },
  });
  // Registered after the shared routes, so these run first.
  await page.route(
    (url) => url.pathname === `/api/game-reviews/game/${E2E_FAKE_GAME_ID}/group/${groupId()}`,
    (route) =>
      onGet(route, async (r) => {
        const selfId = new URL(r.request().url()).searchParams.get('user_id');
        await r.fulfill({ json: reviews ? REVIEWS(selfId, ownReview) : [] });
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/events/group/${groupId()}`,
    (route) => onGet(route, async (r) => r.fulfill({ json: sessions ? SESSIONS() : [] })),
  );
}

/** Open the staged game view and wait for every staged section. */
export async function openGame(page: Page, staging: GameStaging = {}): Promise<Locator> {
  const { ownReview = true, sessions = true, reviews = true } = staging;
  await stageGame(page, staging);
  await page.goto(gamePath());
  const main = page.getByRole('main');
  await main.getByRole('heading', { level: 1, name: GAME_NAME }).waitFor({ state: 'visible', timeout: 15_000 });
  await main.getByRole('heading', { name: sessions ? 'Game Sessions (3)' : 'Game Sessions (0)', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  if (sessions) {
    const kebab = main.getByRole('button', { name: 'Session actions', exact: true }).filter({ visible: true });
    const desktopDelete = main.getByTitle('Delete this session', { exact: true }).filter({ visible: true });
    await kebab.or(desktopDelete).first().waitFor({ state: 'visible', timeout: 15_000 });
  } else {
    await main.getByText('No game sessions yet', { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
  }
  if (!reviews) await main.getByText('No reviews yet. Be the first to review this game.', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  else if (ownReview) await main.getByText('(You)', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  else await main.getByRole('heading', { name: 'Reviews (2)', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  if (!ownReview || !reviews) await main.getByRole('button', { name: 'Add Review', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(main);
  return main;
}

// R05-game: the game page, the whole main.
const reachGame: SurfaceRow['reach'] = async (page) => ({ root: await openGame(page) });

const say = (line: string): void => {
  process.stdout.write(`ZZ29 ${line}\n`);
};

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
  });
}

/**
 * The page boxes of the game view's rows, each as name=left,top,width,height (page coordinates,
 * two decimals): the breadcrumb's pieces, Show More, each session's date, duration, actions and
 * participant chips, the Reviews heading and Add Review, and each review's name line, date, stars,
 * Recommended and Edit.
 */
export async function gameRowBoxes(page: Page): Promise<string[]> {
  return page.getByRole('main').evaluate((main) => {
    const out: string[] = [];
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const add = (name: string, el: Element | null | undefined): void => {
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return;
      out.push(`${name}=${r2(box.left + window.scrollX)},${r2(box.top + window.scrollY)},${r2(box.width)},${r2(box.height)}`);
    };
    const visible = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      return box.width > 0 || box.height > 0;
    };
    const crumbs = main.querySelector('nav[aria-label="Breadcrumb"]');
    add('crumbs', crumbs);
    Array.from(crumbs?.querySelectorAll('a, span[aria-current], span[aria-hidden="true"]') ?? []).forEach((el, at) => add(`crumb${at}`, el));
    add('showMore', main.querySelector('button[aria-controls="game-description"]'));
    const actions = Array.from(main.querySelectorAll('button[aria-label="Session actions"], button[title="Edit this session"], button[title="Delete this session"]')).filter(visible);
    const rows = [...new Set(actions.map((el) => el.closest('div.mb-2')))].filter((row): row is Element => row !== null);
    rows.forEach((row, at) => {
      add(`s${at}.date`, row.querySelector('p'));
      add(`s${at}.duration`, row.querySelector('p + span'));
      Array.from(row.querySelectorAll('button[aria-label="Session actions"], button[title="Edit this session"], button[title="Delete this session"]'))
        .filter(visible)
        .forEach((el, n) => add(`s${at}.action${n}`, el));
      // Each participant chip of the session, and the pieces of its name (the name, its tag or its friend control).
      Array.from(row.parentElement?.querySelectorAll('div.flex-wrap > span.border') ?? []).forEach((chip, n) => {
        add(`s${at}.chip${n}`, chip);
        Array.from(chip.firstElementChild?.children ?? []).forEach((piece, m) => add(`s${at}.chip${n}.name${m}`, piece));
      });
    });
    const reviewsHeading = Array.from(main.querySelectorAll('h2')).find((h) => (h.textContent ?? '').startsWith('Reviews'));
    add('reviews.heading', reviewsHeading);
    const card = reviewsHeading?.closest('.card');
    add('reviews.add', Array.from(card?.querySelectorAll('button') ?? []).find((b) => (b.textContent ?? '').trim() === 'Add Review'));
    Array.from(card?.querySelectorAll('[role="img"][aria-label^="Rated"]') ?? []).forEach((stars, at) => {
      const row = stars.closest('div.mb-2');
      add(`r${at}.name`, row?.querySelector('p'));
      add(`r${at}.date`, row?.querySelector('p.text-sm'));
      add(`r${at}.stars`, stars.parentElement);
      add(`r${at}.recommended`, Array.from(row?.querySelectorAll('p') ?? []).find((p) => (p.textContent ?? '').includes('Recommended')));
      add(`r${at}.edit`, Array.from(row?.querySelectorAll('button') ?? []).find((b) => (b.textContent ?? '').trim() === 'Edit'));
    });
    return out;
  });
}

// R05-game extras. In the 320 normal-text cell the page is also sized to 375 x 667 and 1280 x 800
// (normal text) and the row boxes are printed, one ZZ29 line per width: recording only, so the
// boxes of one commit can be laid beside the next one's (normal text must not move).
const gameExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  if (cell.id !== '320x568-dark-100') return;
  for (const size of [
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await twoFrames(page);
    say(`R05-game boxes ${size.width}x${size.height} ${(await gameRowBoxes(page)).join(' ')}`);
  }
  await page.setViewportSize({ width: cell.width, height: cell.height });
  await twoFrames(page);
};

export const rows: SurfaceRow[] = [
  { id: 'R05-game', census: 'R05', kind: 'route', owner: '89.6-29', status: 'enforced', reach: reachGame, extras: gameExtras },
  { id: 'D29', census: 'D29', kind: 'dialog', owner: '89.6-29', status: 'pending' },
  { id: 'D30', census: 'D30', kind: 'dialog', owner: '89.6-29', status: 'pending' },
];
