// Surface rows: the game page (the game view of census R05), its two empty states and the two review
// dialogs. Owner: plan 89.6-29.
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
// R05-game are printed as ZZ29 lines, six boxes to a line (the phase reads them with
// execute/ci-log.sh in the planning folder, which cuts a line at 400 characters).
import type { Locator, Page } from '@playwright/test';

import { E2E_FAKE_GAME_ID, routeFakeGameSuccess } from '../fakeGame';
import { settleAnimations } from '../inFlight';
import { routeMemberRoster } from '../memberRoster';
import { TWO_WORD_NAME } from '../wordLines';
import { toDialogTop } from './dialogs';
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
 * two decimals): the breadcrumb and the text of each of its pieces (the words, not the link's box,
 * so a link's ring gutter does not show as a move), the picture, the details column and the title,
 * Show More, each session's date, duration, actions and participant chips, the Reviews heading and
 * Add Review, and each review's name line, date, stars, Recommended and Edit.
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
    Array.from(crumbs?.querySelectorAll('a, span[aria-current], span[aria-hidden="true"]') ?? []).forEach((el, at) => {
      const words = document.createRange();
      words.selectNodeContents(el);
      const box = words.getBoundingClientRect();
      out.push(`crumb${at}=${r2(box.left + window.scrollX)},${r2(box.top + window.scrollY)},${r2(box.width)},${r2(box.height)}`);
    });
    const title = main.querySelector('h1');
    add('picture', title?.parentElement?.previousElementSibling);
    add('details', title?.parentElement);
    add('title', title);
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

/**
 * Pick OW-1 = A (the description keeps its three-line clamp on phones; Show More is held at the 44px
 * floor). Wherever the phone layout draws (below the md breakpoint, which the font32 cell is too):
 * Show More is drawn and at least 44px tall, the description is three lines and has more below
 * them; one press shows the whole text (Show Less, also at the floor) and a second press puts the
 * three lines back. Nothing here writes. From md up the whole text shows and no toggle draws.
 */
async function showMoreProblems(page: Page): Promise<string[]> {
  const main = page.getByRole('main');
  const toggle = main.locator('button[aria-controls="game-description"]');
  const phoneLayout = await page.evaluate(() => !window.matchMedia('(min-width: 48rem)').matches);
  const drawn = await toggle.isVisible();
  if (!phoneLayout) return drawn ? ['Show More is drawn from md up, where the whole description shows'] : [];
  if (!drawn) return ['Show More is not drawn in the phone layout (the description is cut with no way to read it)'];
  const read = () =>
    main.evaluate((root) => {
      const text = root.querySelector('#game-description');
      const button = root.querySelector('button[aria-controls="game-description"]');
      if (!text || !button) return null;
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      return {
        label: (button.textContent ?? '').trim(),
        expanded: button.getAttribute('aria-expanded'),
        height: Math.round(button.getBoundingClientRect().height * 100) / 100,
        lines: Math.round((text.getBoundingClientRect().height / lineHeight) * 100) / 100,
        hidden: text.scrollHeight - text.clientHeight,
      };
    });
  const problems: string[] = [];
  const closed = await read();
  if (!closed) return ['the description or its toggle is gone'];
  if (closed.label !== 'Show More' || closed.expanded !== 'false') problems.push(`the toggle reads "${closed.label}" (aria-expanded ${closed.expanded}) before it is pressed`);
  if (closed.height < 43.99) problems.push(`Show More is ${closed.height}px tall (floor 44)`);
  if (Math.abs(closed.lines - 3) > 0.05) problems.push(`the description is ${closed.lines} lines before Show More is pressed (the clamp is three)`);
  if (closed.hidden <= 1) problems.push('the description has nothing below its three lines, so Show More should not draw');
  await toggle.click();
  await twoFrames(page);
  const open = await read();
  if (!open) return [...problems, 'the description or its toggle is gone after the press'];
  if (open.label !== 'Show Less' || open.expanded !== 'true') problems.push(`after the press the toggle reads "${open.label}" (aria-expanded ${open.expanded})`);
  if (open.height < 43.99) problems.push(`Show Less is ${open.height}px tall (floor 44)`);
  if (open.hidden > 1) problems.push(`after the press ${open.hidden}px of the description is still cut`);
  await toggle.click();
  await twoFrames(page);
  const again = await read();
  if (!again || Math.abs(again.lines - 3) > 0.05 || again.label !== 'Show More') problems.push('a second press did not put the three lines and Show More back');
  return problems;
}

// R05-game extras. In the 320 normal-text cell the page is also sized to 375 x 667, 768 x 1024 and
// 1280 x 800 (normal text) and the row boxes are printed as ZZ29 lines: recording only, so the
// boxes of one commit can be laid beside the next one's (normal text must not move). In every
// cell: the Show More check above.
const gameExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const problems = (await showMoreProblems(page)).map((line) => `${cell.id}: ${line}`);
  if (cell.id === '320x568-dark-100') {
    // The same check at 375 wide, normal text (the lane has no such cell).
    await page.setViewportSize({ width: 375, height: 667 });
    await twoFrames(page);
    problems.push(...(await showMoreProblems(page)).map((line) => `375x667 normal text: ${line}`));
    await page.setViewportSize({ width: cell.width, height: cell.height });
    await twoFrames(page);
  }
  // A soft failure would leave the cell marked passed, so the problems are thrown as one line.
  if (problems.length > 0) throw new Error(`R05-game Show More (OW-1 = A): ${problems.join(' | ')}`);
  if (cell.id !== '320x568-dark-100') return;
  for (const size of [
    { width: 375, height: 667 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await twoFrames(page);
    const boxes = await gameRowBoxes(page);
    for (let at = 0; at < boxes.length; at += 6) say(`R05-game boxes ${size.width}x${size.height} ${boxes.slice(at, at + 6).join(' ')}`);
  }
  await page.setViewportSize({ width: cell.width, height: cell.height });
  await twoFrames(page);
};

// The card (the nearest .card above the line) that holds an empty-state line.
const cardOf = (line: Locator): Locator => line.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " card ")][1]');

// R05-game-sessions-empty: the staged game view with the group's events read answered as an empty
// list (no history at all, so the ruled empty line shows, not the filtered one). The root is the
// Game Sessions card.
const reachSessionsEmpty: SurfaceRow['reach'] = async (page) => {
  const main = await openGame(page, { sessions: false });
  const card = cardOf(main.getByText('No game sessions yet', { exact: false }));
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  return { root: card };
};

// R05-game-reviews-empty: the staged game view with the reviews read answered as an empty list. The
// root is the Reviews card, its header and Add Review included.
const reachReviewsEmpty: SurfaceRow['reach'] = async (page) => {
  const main = await openGame(page, { reviews: false });
  const card = cardOf(main.getByText('No reviews yet. Be the first to review this game.', { exact: true }));
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.getByRole('button', { name: 'Add Review', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: card };
};

// D29 and D30: the review form. D29 is the staged game view without the viewer's own review, where
// Add Review opens Write a Review; D30 is the staged view with it, where the own review's Edit opens
// Edit Your Review. Neither reach submits: opening the form writes nothing.
type ReviewDialogName = 'Write a Review' | 'Edit Your Review';
const reviewDialog = (page: Page, name: ReviewDialogName): Locator => page.getByRole('dialog', { name, exact: true });
async function openReviewDialog(page: Page, name: ReviewDialogName, opener: Locator): Promise<{ root: Locator; dialog: Locator }> {
  await opener.click();
  const dialog = reviewDialog(page, name);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
}
const reachWriteReview: SurfaceRow['reach'] = async (page) => {
  const main = await openGame(page, { ownReview: false });
  return openReviewDialog(page, 'Write a Review', main.getByRole('button', { name: 'Add Review', exact: true }));
};
const reachEditReview: SurfaceRow['reach'] = async (page) => {
  const main = await openGame(page);
  // The own review's Edit (the sessions draw an Edit of their own from md up).
  const own = main.locator('div.border-l-4').filter({ hasText: '(You)' });
  return openReviewDialog(page, 'Edit Your Review', own.getByRole('button', { name: 'Edit', exact: true }));
};

// D29 and D30 extras (a tall dialog scrolls, plans 89.6-10 and -11). The form's submit button sits in
// the dialog body, not in a footer (src/app/gameDetail/page.js ("The submit button stays INSIDE the <form>")), so the
// shell read does not list it and it is read here: scrolled into view, it lies inside the dialog
// box, is the thing under a finger at its centre and is at least 44px tall.
const reviewDialogExtras = (name: ReviewDialogName, submit: string): NonNullable<SurfaceRow['extras']> =>
  async (page: Page, cell: SweepCell) => {
    const dialog = reviewDialog(page, name);
    const problems = await dialog.evaluate((box, label) => {
      const out: string[] = [];
      const button = Array.from(box.querySelectorAll('button')).find((candidate) => (candidate.textContent ?? '').trim() === label);
      if (!button) return [`the dialog holds no "${label}" button`];
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const at = button.getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      if (at.left < frame.left - 0.5 || at.right > frame.right + 0.5 || at.top < frame.top - 0.5 || at.bottom > frame.bottom + 0.5) out.push(`"${label}", scrolled into view, is outside the dialog box`);
      const under = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
      if (!under || !(under === button || button.contains(under))) out.push(`"${label}", scrolled into view, is not the thing under a finger at its centre`);
      if (at.height < 43.99) out.push(`"${label}" is ${Math.round(at.height * 100) / 100}px tall (floor 44)`);
      return out;
    }, submit);
    await toDialogTop(dialog);
    if (problems.length > 0) throw new Error(`${name} ${cell.id}: ${problems.join(' | ')}`);
  };

export const rows: SurfaceRow[] = [
  { id: 'R05-game', census: 'R05', kind: 'route', owner: '89.6-29', status: 'enforced', reach: reachGame, extras: gameExtras },
  { id: 'R05-game-sessions-empty', census: 'R05', kind: 'route', owner: '89.6-29', state: 'No game sessions yet', status: 'enforced', reach: reachSessionsEmpty },
  { id: 'R05-game-reviews-empty', census: 'R05', kind: 'route', owner: '89.6-29', state: 'No reviews yet', status: 'enforced', reach: reachReviewsEmpty },
  { id: 'D29', census: 'D29', kind: 'dialog', owner: '89.6-29', status: 'enforced', reach: reachWriteReview, extras: reviewDialogExtras('Write a Review', 'Submit Review') },
  { id: 'D30', census: 'D30', kind: 'dialog', owner: '89.6-29', status: 'enforced', reach: reachEditReview, extras: reviewDialogExtras('Edit Your Review', 'Update Review') },
];
