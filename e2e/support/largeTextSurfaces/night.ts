// Surface rows: the night page (the event view of census R05), Participants and Delete this session. Owner: plan 89.6-19.
// One row per line, each with its census id. Plan 89.6-19 turned all three on; D31 waits under plan 89.6-29 (its marker).
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

import { E2E_FAKE_GAME_ID, E2E_GAME_PATH, routeFakeGameSuccess } from '../fakeGame';
import { settleAnimations } from '../inFlight';
import { EXCEPTION_SELECTORS } from '../largeTextExceptions';
import { routeMemberRoster } from '../memberRoster';
import { scrubbedFetch } from '../scrubbedFetch';
import { TWO_WORD_NAME, expectLargeTextCell, expectPageZoomUsable, readLargeTextCell, readPageZoomCell } from '../wordLines';
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
  await main.getByRole('link', { name: 'Azul', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
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

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

/** Scroll every scrolled box of a dialog back to its top: the header at the top, as plans 10 and 11 read a tall dialog. */
async function toDialogTop(dialog: Locator): Promise<void> {
  await dialog.evaluate((el) => {
    for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) if (node.scrollTop > 0) node.scrollTop = 0;
  });
}

// D27: the staged night's See all (7) opens the Participants dialog.
const participantsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Participants (7)', exact: true });
const reachParticipants: SurfaceRow['reach'] = async (page) => {
  const main = await openNight(page);
  await main.getByRole('button', { name: 'See all (7) →', exact: true }).click();
  const dialog = participantsDialog(page);
  await dialog.getByRole('button', { name: `Remove ${LONG_NAME} from this event`, exact: true }).waitFor({ state: 'attached', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D27 extras, every cell: the long-name guest's Remove is pressed ONCE (it arms to Tap again; the
// two-tap has no timer since plan 89.6-04, and nothing commits on one press), the armed dialog is
// read with the cell's checks, then the dialog heading is pressed (an outside press disarms and
// says Confirmation cancelled.). One page serves every cell, so the disarm is ASSERTED before the
// extras return: a heading press that did not disarm would make the next cell's single press the
// committing second tap (review M023). An armed control found before the press fails the cell
// with nothing pressed.
const RESTING_REMOVE = `Remove ${LONG_NAME} from this event`;
const ARMED_REMOVE = 'Tap again to confirm';
const participantsExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `D27 ${cell.id}`;
  const dialog = participantsDialog(page);
  const resting = dialog.getByRole('button', { name: RESTING_REMOVE, exact: true });
  const armed = dialog.getByRole('button', { name: ARMED_REMOVE, exact: true });
  if ((await armed.count()) > 0) throw new Error(`${tag}: a Remove was already armed before this cell's press; nothing was pressed`);
  await resting.click();
  await armed.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await resting.count()) !== 0) throw new Error(`${tag}: the armed Remove is not the long-name guest's`);
  await settleAnimations(dialog);
  const problems: string[] = [];
  try {
    const at = `${tag} with Remove armed`;
    if (cell.zoom) expectPageZoomUsable(await readPageZoomCell(dialog, { exceptions: EXCEPTION_SELECTORS, dialog }), at);
    else expectLargeTextCell(await readLargeTextCell(dialog, { exceptions: EXCEPTION_SELECTORS, dialog }), at);
  } catch (error) {
    problems.push(firstLine(error));
  }
  await dialog.getByRole('heading', { name: 'Participants (7)', exact: true }).click();
  try {
    await resting.waitFor({ state: 'attached', timeout: 5_000 });
  } catch {
    throw new Error(`${tag}: pressing the dialog heading did not disarm the long-name Remove; no further press is made${problems.length > 0 ? ` || ${problems.join(' || ')}` : ''}`);
  }
  if ((await armed.count()) !== 0) throw new Error(`${tag}: a button still reads ${ARMED_REMOVE} after the heading press`);
  await toDialogTop(dialog);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D31: the game view (the shared fake custom game) with one past session of that game added to the
// group's events read in the browser, a winner and two participants; the session's Delete opens the
// Delete this session? dialog (the phone's Session actions menu below md, the Delete button from md
// up). The dialog's Delete is NEVER pressed.
const pastSession = () => ({
  id: uuid('5e5510'),
  group_id: groupId(),
  game_id: E2E_FAKE_GAME_ID,
  start_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  duration_minutes: 90,
  status: 'completed',
  is_group_win: false,
  comments: null,
  Winner: { id: null, username: TWO_WORD_NAME, is_custom: true },
  EventParticipations: [
    { id: uuid('a8'), user_id: null, username: TWO_WORD_NAME, is_guest: true, is_custom: true },
    { id: uuid('a9'), user_id: uuid('e3'), username: SHORT_GUEST, is_guest: true, is_custom: false },
  ],
});
const sessionStaged = new WeakSet<Page>();
async function stageGameSession(page: Page): Promise<void> {
  if (sessionStaged.has(page)) return;
  sessionStaged.add(page);
  await routeMemberRoster(page, groupId(), everyMemberAnOwner);
  await routeFakeGameSuccess(page);
  await page.route(
    (url) => url.pathname === `/api/events/group/${groupId()}`,
    (route) =>
      onGet(route, async (r) => {
        const real = await realJson(r);
        await r.fulfill({ json: [...(Array.isArray(real) ? real : []), pastSession()] });
      }),
  );
}
const deleteSessionDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Delete this session?', exact: true });
const reachDeleteSession: SurfaceRow['reach'] = async (page) => {
  await stageGameSession(page);
  await page.goto(E2E_GAME_PATH);
  const kebab = page.getByRole('button', { name: 'Session actions', exact: true }).filter({ visible: true });
  const desktopDelete = page.getByTitle('Delete this session', { exact: true }).filter({ visible: true });
  await kebab.or(desktopDelete).first().waitFor({ state: 'visible', timeout: 15_000 });
  if (await kebab.count()) {
    await kebab.first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).first().click();
  } else {
    await desktopDelete.first().click();
  }
  const dialog = deleteSessionDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D31 extras (a tall dialog scrolls, plans 89.6-10 and -11): each footer button, scrolled into view,
// lies inside the dialog box and is the thing under a finger at its centre. readShell is the shell
// module's read, imported when the extras run (the shell module imports the dialogs module).
const deleteSessionExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const { readShell } = await import('./dialogShell');
  const read = await readShell(deleteSessionDialog(page));
  const footer = read.buttons.filter((button) => button.part === 'footer');
  const problems: string[] = [];
  if (footer.length === 0) problems.push(`D31 ${cell.id}: the dialog footer holds no button`);
  for (const button of footer) {
    const at = button.reached?.box ?? button.box;
    const box = button.reached?.dialog ?? read.dialog;
    if (at.left < box.left - 0.5 || at.right > box.right + 0.5 || at.top < box.top - 0.5 || at.bottom > box.bottom + 0.5) {
      problems.push(`D31 ${cell.id}: the footer button "${button.label}", scrolled into view, is outside the dialog box`);
    }
    if (!button.reached?.onTop) problems.push(`D31 ${cell.id}: the footer button "${button.label}", scrolled into view, is not the thing under a finger at its centre`);
  }
  await toDialogTop(deleteSessionDialog(page));
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'R05-event', census: 'R05', kind: 'route', owner: '89.6-19', status: 'enforced', reach: reachNight, extras: nightExtras },
  { id: 'D27', census: 'D27', kind: 'dialog', owner: '89.6-19', status: 'enforced', reach: reachParticipants, extras: participantsExtras },
  // DECISION Phase 89.6-19 (D31 pending under plan 89.6-29; orchestrator decision D17 B of 2026-11-25, the owner can
  // veto): this row goes from enforced to PENDING under plan 89.6-29, which owns the game view, chosen OVER fixing the
  // red here and OVER leaving it enforced and red. The dialog itself holds every cell; its one red is the page behind
  // it scrolling sideways at 320 x 568, 200% text (30px, runs 45637143022 and 45641026757), and a read-only diagnostic
  // in run 45641026757 named the game view's Add Review button reaching x=350 there: the Reviews header,
  // src/app/gameDetail/page.js ("Reviews{reviewsLoadState.showError"), is a flex justify-between items-center mb-4 row
  // whose button does not move under the heading. That header carries the owner-ruled D-39 / DEF-88-24-02 markers, and
  // weighing them belongs to the plan that sweeps that surface with its context. Plan 89.6-29 turns this row back on
  // with its fix; the coverage script's --close run fails on any pending row, so the phase cannot close with it off.
  // Changing this is a decision, not a cleanup.
  { id: 'D31', census: 'D31', kind: 'dialog', owner: '89.6-29', status: 'pending', reach: reachDeleteSession, extras: deleteSessionExtras },
];
