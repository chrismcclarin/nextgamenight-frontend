// Surface rows: the group page, one row per part of the page (census R07). Owner: plan 89.6-17.
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

import { GROUP_ICON_EMOJI, GROUP_ICON_PICTURE, routeGroupRead, type GroupRow } from '../groupRead';
import { settleAnimations } from '../inFlight';
import type { SurfaceRow, SweepCell } from './index';

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

// R07-games: the Overview with the picture icon; the play-history read answered empty (its rows are
// R07-history's), so this row also shows the No game nights logged yet state (EMPTY_STATES).
const reachGames: SurfaceRow['reach'] = (page) => openGroup(page, withIcon(GROUP_ICON_PICTURE));
// R07-emoji: the same with the emoji icon.
const reachEmoji: SurfaceRow['reach'] = (page) => openGroup(page, withIcon(GROUP_ICON_EMOJI));
const answerNoGames = (url: URL): unknown => (isGamesRead(url) ? [] : undefined);

// The title row's icon (src/app/groupHomePage/page.js ("DECISION Phase 89.6-17 (title-icon)")): not
// drawn while the row is narrower than picture, gaps, a 7.5rem title and the 44px gear. Drawn in the
// two 768 cells; not drawn in the 320 and 375 cells at 200% or in the two page-zoom cells. Found by
// position (the element before the h1's column), never by a class.
const iconDrawnIn = (cell: SweepCell): boolean => cell.width >= 768;
const titleRowExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  const icon = await page.getByRole('heading', { level: 1 }).evaluate((h1) => {
    const box = h1.parentElement?.previousElementSibling ?? null;
    return { present: box !== null, drawn: box !== null && box.getClientRects().length > 0 };
  });
  expect(icon, `title-icon: in ${cell.id} the group icon box is ${icon.present ? (icon.drawn ? 'drawn' : 'not drawn') : 'absent'}`).toEqual({
    present: true,
    drawn: iconDrawnIn(cell),
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
const headerExtras: NonNullable<SurfaceRow['extras']> = async (page, cell) => {
  await titleRowExtras(page, cell);
  await gearExtras(page, cell);
};

export const rows: SurfaceRow[] = [
  { id: 'R07-games', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', reach: reachGames, answers: answerNoGames, extras: headerExtras },
  { id: 'R07-emoji', census: 'R07', kind: 'route', owner: '89.6-17', status: 'enforced', state: 'emoji icon', reach: reachEmoji, answers: answerNoGames, extras: headerExtras },
  { id: 'R07-library', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
  { id: 'R07-checkins', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
  { id: 'R07-history', census: 'R07', kind: 'route', owner: '89.6-17', status: 'pending' },
];
