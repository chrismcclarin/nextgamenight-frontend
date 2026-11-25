// Surface rows: the night page (the event view of census R05), Participants and Delete this session. Owner: plan 89.6-19.
// One row per line, each with its census id. R05-event is enforced (Phase 89.6-19); D27 and D31 are pending.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// WHAT IS STAGED (stageNight). The real event read of the CI fixture night, answered in the browser
// with its start moved to tomorrow at 19:00 (so Share Game QR and the RSVP trio show) and seven
// participants: three guests first, so all three are on the five-chip strip (a typed-in two-word
// name, a guest with an account and a 42-letter hyphenated name, a guest with an account and a short
// name), then four short names. The group's members read is the real roster with every member an
// owner, so Invite and Remove render. The RSVP read holds every roster member as yes (the viewer
// among them, so the ballot offers its vote) plus one maybe and one no, so the count line shows
// three counts. The ballot read is an open ballot with two options, the voted one named with the
// two-word name. The brings read is one bringer with two games.
//
// EVERY ANSWER IS IN THE BROWSER. Each staged read is fetched from the real server (or not at all)
// and rewritten before the page sees it; a staged row exists only in the answer sent to the browser,
// its id is in no database, and nothing is written (the sweep's guard holds every write).
import type { Locator, Page, Route } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { routeMemberRoster } from '../memberRoster';
import { scrubbedFetch } from '../scrubbedFetch';
import { TWO_WORD_NAME } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login owns.
// No fallback id, as in e2e/support/largeTextSurfaces/members.ts ("No fallback id").
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the night rows open that group');
  return id;
};

// The fixture night, derived as e2e/gamedetail-refresh-failed.spec.ts derives it ("const E2E_EVENT_DETAIL_PATH =").
const eventPath = (): string => process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${groupId()}`;
const eventId = (): string => new URL(eventPath(), 'http://localhost').searchParams.get('event_id') ?? '1';

export const LONG_NAME = 'Bartholomew Featherstonehaugh-Cholmondeley';
export const SHORT_GUEST = 'Pat Lee';
const uuid = (tail: string): string => `8861a072-0000-4000-8000-${tail.padStart(12, '0')}`;

export const NIGHT_PARTICIPANTS = [
  { id: uuid('a1'), user_id: null, username: TWO_WORD_NAME, is_guest: true, is_custom: true },
  { id: uuid('a2'), user_id: uuid('e2'), username: LONG_NAME, is_guest: true, is_custom: false },
  { id: uuid('a3'), user_id: uuid('e3'), username: SHORT_GUEST, is_guest: true, is_custom: false },
  { id: uuid('a4'), user_id: uuid('e4'), username: 'Alice', is_guest: false, is_custom: false },
  { id: uuid('a5'), user_id: uuid('e5'), username: 'Bob', is_guest: false, is_custom: false },
  { id: uuid('a6'), user_id: uuid('e6'), username: 'Carol', is_guest: false, is_custom: false },
  { id: uuid('a7'), user_id: uuid('e7'), username: 'Dan', is_guest: false, is_custom: false },
];

/** Tomorrow at 19:00, in the runner's local time. */
function tomorrowEvening(): string {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(19, 0, 0, 0);
  return at.toISOString();
}

type RosterRow = { id?: string; username?: string; UserGroup?: { role?: string } | null };
const everyMemberAnOwner = (rows: unknown[]): unknown[] =>
  rows.map((row) => {
    const member = row as RosterRow;
    return member.UserGroup ? { ...member, UserGroup: { ...member.UserGroup, role: 'owner' } } : row;
  });

/** GET only: everything else falls back, so a write still reaches the sweep's hold. */
async function onGet(route: Route, answer: (route: Route) => Promise<void>): Promise<void> {
  if (route.request().method() !== 'GET') {
    await route.fallback();
    return;
  }
  await answer(route);
}

/** The real read as JSON, or undefined when it was not JSON. */
async function realJson(route: Route, url?: string): Promise<unknown> {
  const response = await scrubbedFetch(route, url === undefined ? undefined : { url });
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// One set of routes per page: the sweep runs a reach again on the same page for the light cell, and
// a page's routes outlive its navigations.
const staged = new WeakSet<Page>();

/** Register the night's staged reads on the page (once), after the sweep's guard. */
export async function stageNight(page: Page): Promise<void> {
  if (staged.has(page)) return;
  staged.add(page);
  const id = eventId();
  await routeMemberRoster(page, groupId(), everyMemberAnOwner);
  await page.route(
    (url) => url.pathname === `/api/events/${id}`,
    (route) =>
      onGet(route, async (r) => {
        const response = await scrubbedFetch(r);
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          await r.fulfill({ response });
          return;
        }
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          Object.assign(body as Record<string, unknown>, { start_date: tomorrowEvening(), status: 'scheduled', EventParticipations: NIGHT_PARTICIPANTS });
        }
        await r.fulfill({ response, json: body });
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/rsvp/event/${id}`,
    (route) =>
      onGet(route, async (r) => {
        const roster = await realJson(r, new URL(`/api/groups/${groupId()}/users`, r.request().url()).toString());
        const members = (Array.isArray(roster) ? roster : []) as RosterRow[];
        const row = (n: number, userId: string, username: string, status: 'yes' | 'maybe' | 'no') => ({
          id: uuid(`c${n}`),
          event_id: id,
          user_id: userId,
          status,
          note: null,
          User: { id: userId, username },
        });
        const rsvps = [
          ...members.filter((m) => typeof m.id === 'string').map((m, n) => row(n + 10, m.id as string, m.username ?? 'Member', 'yes')),
          row(1, uuid('e8'), 'Dana Fox', 'maybe'),
          row(2, uuid('e9'), 'Eli Park', 'no'),
        ];
        const summary = { yes: rsvps.filter((x) => x.status === 'yes').length, maybe: 1, no: 1 };
        await r.fulfill({ json: { rsvps, summary } });
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/ballot/${id}`,
    (route) =>
      onGet(route, async (r) => {
        await r.fulfill({
          json: {
            event_id: id,
            ballot_status: 'open',
            rsvp_deadline: null,
            options: [
              { id: uuid('b1'), game_id: null, game_name: TWO_WORD_NAME, user_voted: true },
              { id: uuid('b2'), game_id: null, game_name: 'Ticket to Ride', user_voted: false },
            ],
          },
        });
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/event-brings/event/${id}`,
    (route) =>
      onGet(route, async (r) => {
        const bring = (n: number, name: string) => ({
          id: uuid(`d${n}`),
          event_id: id,
          user_id: uuid('e3'),
          game_id: uuid(`f${n}`),
          Game: { id: uuid(`f${n}`), name },
          User: { id: uuid('e3'), username: SHORT_GUEST },
        });
        await r.fulfill({ json: [bring(1, 'Ticket to Ride'), bring(2, 'Azul')] });
      }),
  );
}

/** Open the staged night and wait for every staged section. */
async function openNight(page: Page): Promise<Locator> {
  await stageNight(page);
  await page.goto(eventPath());
  const main = page.getByRole('main');
  await main.getByRole('heading', { level: 1, name: 'Game Night' }).waitFor({ state: 'visible', timeout: 15_000 });
  await main.getByRole('heading', { name: 'Participants (7)' }).waitFor({ state: 'visible', timeout: 15_000 });
  await main.getByRole('button', { name: `Invite ${LONG_NAME} to the group`, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await main.getByText('1 No', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await main.getByText('Voted', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await main.getByText('Azul', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(main);
  return main;
}

// R05-event: the night page, the whole main.
const reachNight: SurfaceRow['reach'] = async (page) => ({ root: await openNight(page) });

const r2 = (n: number): number => Math.round(n * 100) / 100;

// R05-event extras, every cell: the long-name chip's Invite keeps its normal size (its height equals
// the short-name guest's Invite within 0.5px, never stretched to the chip). At 320 x 568 with 200%
// text the long-name chip's Invite also sits under the chip (owner pick O-9c = B, the card's read).
const nightExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const main = page.getByRole('main');
  const longInvite = await main.getByRole('button', { name: `Invite ${LONG_NAME} to the group`, exact: true }).boundingBox();
  const shortInvite = await main.getByRole('button', { name: `Invite ${SHORT_GUEST} to the group`, exact: true }).boundingBox();
  const problems: string[] = [];
  if (!longInvite || !shortInvite) problems.push(`R05-event ${cell.id}: an Invite on the strip has no box`);
  else if (Math.abs(longInvite.height - shortInvite.height) > 0.5) {
    problems.push(`R05-event ${cell.id}: the long-name Invite is ${r2(longInvite.height)}px tall, the short-name Invite ${r2(shortInvite.height)}px (O-9c: Invite keeps its normal size)`);
  }
  if (longInvite && cell.width === 320 && cell.mode === '200') {
    const chip = await main.locator('span.border.border-line', { hasText: LONG_NAME }).first().boundingBox();
    if (!chip) problems.push(`R05-event ${cell.id}: the long-name chip has no box`);
    else if (longInvite.y < chip.y + chip.height - 0.5) {
      problems.push(`R05-event ${cell.id}: the long-name Invite top ${r2(longInvite.y)} is above the chip bottom ${r2(chip.y + chip.height)} (O-9c at 320 / 200%: Invite under the chip)`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'R05-event', census: 'R05', kind: 'route', owner: '89.6-19', status: 'enforced', reach: reachNight, extras: nightExtras },
  { id: 'D27', census: 'D27', kind: 'dialog', owner: '89.6-19', status: 'pending' },
  { id: 'D31', census: 'D31', kind: 'dialog', owner: '89.6-19', status: 'pending' },
];
