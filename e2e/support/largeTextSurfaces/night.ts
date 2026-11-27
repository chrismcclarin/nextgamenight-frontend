// Surface rows: the night page (the event view of census R05), Participants and Delete this session. Owner: plan 89.6-19.
// One row per line, each with its census id. Plan 89.6-19 turned all three on; D31 went pending under plan 89.6-29,
// which turned it on again (its marker).
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
// THE PEOPLE BEHIND THE TAGS (stageNightPeople, plan 89.6-44, orchestrator decision D46). The night
// rows of this module (R05-event and D27) also answer, after stageNight, so these answers win: the
// event read with the fourth and fifth participants replaced by two REAL roster members (the
// group's owner, who is the viewer in CI, and the first other member), the members read with that
// other member an admin, the accepted-friends read with the sixth participant in it and the
// sent-requests read with the seventh. So the strip draws Owner and Admin on a chip, and See all
// draws (You), Owner, Admin, Friend and Pending, and readTagLines reads them. The rows of other
// modules that open the staged night (the popover, the bring picker) keep stageNight alone.
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
import { TWO_WORD_NAME, expectLargeTextCell, expectPageZoomUsable, readLargeTextCell, readPageZoomCell, setTextMode } from '../wordLines';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login owns.
// No fallback id, as in e2e/support/largeTextSurfaces/members.ts ("No fallback id").
export const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the night rows open that group');
  return id;
};

// The fixture night, derived as e2e/gamedetail-refresh-failed.spec.ts derives it ("const E2E_EVENT_DETAIL_PATH =").
const eventPath = (): string => process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${groupId()}`;
const eventId = (): string => new URL(eventPath(), 'http://localhost').searchParams.get('event_id') ?? '1';

export const LONG_NAME = 'Bartholomew Featherstonehaugh-Cholmondeley';
export const SHORT_GUEST = 'Pat Lee';
export const uuid = (tail: string): string => `8861a072-0000-4000-8000-${tail.padStart(12, '0')}`;

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
export const everyMemberAnOwner = (rows: unknown[]): unknown[] =>
  rows.map((row) => {
    const member = row as RosterRow;
    return member.UserGroup ? { ...member, UserGroup: { ...member.UserGroup, role: 'owner' } } : row;
  });

/** GET only: everything else falls back, so a write still reaches the sweep's hold. */
export async function onGet(route: Route, answer: (route: Route) => Promise<void>): Promise<void> {
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

const FRIEND = { id: uuid('e6'), username: 'Carol' };
const REQUESTED = { id: uuid('e7'), username: 'Dan' };

// The roster's owner (the CI login owns the seeded group) and the first member who is not.
const ownerAndOther = (rows: unknown[]): { owner?: RosterRow; other?: RosterRow } => {
  const members = (rows as RosterRow[]).filter((m) => typeof m.id === 'string');
  const owner = members.find((m) => m.UserGroup?.role === 'owner');
  return { owner, other: members.find((m) => m !== owner) };
};
// The members read for the night rows: every member an owner, as stageNight has it (so Invite and
// Remove render whoever the viewer is), except the first member who is not the real owner: an admin.
const ownersAndOneAdmin = (rows: unknown[]): unknown[] => {
  const { other } = ownerAndOther(rows);
  return rows.map((row) => {
    const member = row as RosterRow;
    if (!member.UserGroup) return row;
    return { ...member, UserGroup: { ...member.UserGroup, role: other && member.id === other.id ? 'admin' : 'owner' } };
  });
};

// One set of people routes per page, as for stageNight.
const peopled = new WeakSet<Page>();

/** Register the people answers of the night rows on the page (once), after stageNight's. */
async function stageNightPeople(page: Page): Promise<void> {
  if (peopled.has(page)) return;
  peopled.add(page);
  const id = eventId();
  await routeMemberRoster(page, groupId(), ownersAndOneAdmin);
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
        const roster = await realJson(r, new URL(`/api/groups/${groupId()}/users`, r.request().url()).toString());
        const { owner, other } = ownerAndOther(Array.isArray(roster) ? roster : []);
        // A roster with no owner or no second member keeps the staged short names: the count stays
        // seven and the extras then name the tags that were not drawn.
        const member = (at: number, from: RosterRow | undefined) =>
          from ? { ...NIGHT_PARTICIPANTS[at], user_id: from.id, username: from.username ?? 'Member' } : NIGHT_PARTICIPANTS[at];
        const participants = [
          ...NIGHT_PARTICIPANTS.slice(0, 3),
          member(3, owner),
          member(4, other),
          { ...NIGHT_PARTICIPANTS[5], user_id: FRIEND.id, username: FRIEND.username },
          { ...NIGHT_PARTICIPANTS[6], user_id: REQUESTED.id, username: REQUESTED.username },
        ];
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          Object.assign(body as Record<string, unknown>, { start_date: tomorrowEvening(), status: 'scheduled', EventParticipations: participants });
        }
        await r.fulfill({ response, json: body });
      }),
  );
  await page.route(
    (url) => url.pathname === '/api/friendships' && url.searchParams.get('status') === 'accepted',
    (route) => onGet(route, (r) => r.fulfill({ json: [{ id: uuid('f6'), friend: FRIEND }] })),
  );
  await page.route(
    (url) => url.pathname === '/api/friendships' && url.searchParams.get('status') === 'pending' && url.searchParams.get('direction') === 'sent',
    (route) => onGet(route, (r) => r.fulfill({ json: [{ id: uuid('f7'), status: 'pending', Addressee: REQUESTED }] })),
  );
}

// The staged tags a night row must DRAW (decision D46): each word, where it is looked for, and how
// many of it. A tag is a leaf span, shown, with exactly that text. Returns one message naming every
// tag that is missing, or nothing.
async function stagedTagsMissing(scope: Locator, wanted: Record<string, number>): Promise<string[]> {
  const found = await scope.evaluate((root, words) => {
    const counts: Record<string, number> = {};
    for (const span of Array.from(root.querySelectorAll('span'))) {
      if (span.childElementCount > 0) continue;
      const word = (span.textContent ?? '').trim();
      if (!words.includes(word)) continue;
      const style = getComputedStyle(span);
      const box = span.getBoundingClientRect();
      if (style.display === 'none' || style.visibility !== 'visible' || box.width === 0 || box.height === 0) continue;
      counts[word] = (counts[word] ?? 0) + 1;
    }
    return counts;
  }, Object.keys(wanted));
  const missing = Object.entries(wanted).filter(([word, count]) => (found[word] ?? 0) < count).map(([word, count]) => `${word} ${found[word] ?? 0} of ${count}`);
  return missing.length === 0 ? [] : [`staged tags not drawn: ${missing.join(', ')}`];
}

/** Open the staged night and wait for every staged section. */
async function openNight(page: Page): Promise<Locator> {
  await stageNight(page);
  await stageNightPeople(page);
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

// The little tags beside a name (owner pick N04 = B, plan 89.6-30): one box, one weight. Read by
// their words, so the read does not depend on how a tag is built.
const TAG_WORDS = ['No reply', 'Going', 'Maybe', 'No', 'Owner', 'Admin', 'Guest', 'Friend', 'New Player', '⏳ Pending'];

// readTagLines: the tag read of plan 89.6-30, used by the night rows here and by the game row
// (e2e/support/largeTextSurfaces/game.ts imports it; one helper, never a copy).
// A tag is a leaf span, shown, not inside a button, whose trimmed text is exactly one of TAG_WORDS.
// Tags are grouped by their nearest .border-line box (the chip or the row). Inside a group two tags
// are on one line when their vertical ranges overlap by more than half the smaller height.
// It returns one message for:
//   each line whose tag heights or tops spread more than 0.5px;
//   each tag drawn in more than one box (it wrapped inside itself);
//   each tag taller than its line height plus its vertical padding plus 0.5px (it broke inside itself);
//   each tag whose computed weight is not 400 (the pick is regular weight everywhere);
//   fewer than min tags found (a read that found nothing proves nothing).
// An empty list means every tag on a line is one height at one top, whole, at regular weight.
export async function readTagLines(scope: Locator, min: number): Promise<string[]> {
  return scope.evaluate(
    (root, { words, floor }) => {
      const round = (n: number): number => Math.round(n * 100) / 100;
      type Tag = { word: string; top: number; bottom: number; height: number; group: Element | null };
      const tags: Tag[] = [];
      const problems: string[] = [];
      for (const span of Array.from(root.querySelectorAll('span'))) {
        if (span.childElementCount > 0) continue;
        const word = (span.textContent ?? '').trim();
        if (!words.includes(word)) continue;
        if (span.closest('button')) continue;
        const style = getComputedStyle(span);
        const rects = span.getClientRects();
        if (style.display === 'none' || style.visibility !== 'visible' || rects.length === 0) continue;
        const box = span.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        tags.push({ word, top: box.top, bottom: box.bottom, height: box.height, group: span.closest('.border-line') });
        if (rects.length > 1) problems.push(`the tag ${word} is drawn in ${rects.length} boxes (it wrapped inside itself)`);
        const fontSize = parseFloat(style.fontSize);
        const lineHeight = Number.isFinite(parseFloat(style.lineHeight)) ? parseFloat(style.lineHeight) : fontSize * 1.5;
        const whole = lineHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        if (box.height > whole + 0.5) problems.push(`the tag ${word} is ${round(box.height)}px tall, more than one line of it (${round(whole)}px): it broke inside itself`);
        if (style.fontWeight !== '400') problems.push(`the tag ${word} has weight ${style.fontWeight}, not 400`);
      }
      if (tags.length < floor) problems.push(`${tags.length} tags found, fewer than ${floor}`);
      const groups = new Map<Element | null, Tag[]>();
      for (const tag of tags) groups.set(tag.group, [...(groups.get(tag.group) ?? []), tag]);
      for (const members of groups.values()) {
        const lines: Tag[][] = [];
        for (const tag of members.sort((a, b) => a.top - b.top)) {
          const line = lines.find((other) =>
            other.some((t) => Math.min(t.bottom, tag.bottom) - Math.max(t.top, tag.top) > Math.min(t.height, tag.height) / 2),
          );
          if (line) line.push(tag);
          else lines.push([tag]);
        }
        for (const line of lines) {
          if (line.length < 2) continue;
          const heights = line.map((t) => t.height);
          const tops = line.map((t) => t.top);
          const heightSpread = Math.max(...heights) - Math.min(...heights);
          const topSpread = Math.max(...tops) - Math.min(...tops);
          if (heightSpread > 0.5 || topSpread > 0.5) {
            problems.push(
              `tags on one line differ (height spread ${round(heightSpread)}px, top spread ${round(topSpread)}px): ${line.map((t) => `${t.word} ${round(t.height)}px tall at top ${round(t.top)}`).join(', ')}`,
            );
          }
        }
      }
      return problems;
    },
    { words: TAG_WORDS, floor: min },
  );
}

// One short line for a cell's record (the CI log read cuts a line at 400 characters): how many tag
// problems, and the first of them.
export const tagSummary = (at: string, messages: string[]): string[] =>
  messages.length === 0 ? [] : [`${at}: ${messages.length} tag problem${messages.length === 1 ? '' : 's'}, the first: ${messages[0]}`];

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
  // Plan 89.6-30 (N04 B): the tags on the Participants card's chips, one box and one weight.
  const card = main.locator('.card', { has: page.getByRole('heading', { name: /^Participants \(/ }) }).last();
  problems.push(...tagSummary(`R05-event ${cell.id} tags`, await readTagLines(card, 3)));
  // Plan 89.6-44 (D46): the roster member's and the viewer's chips draw Admin and Owner.
  problems.push(...(await stagedTagsMissing(card, { Owner: 1, Admin: 1 })).map((line) => `R05-event ${cell.id}: ${line}`));
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

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
  // Plan 89.6-30 (N04 B): the tags on the dialog's rows, one box and one weight, read with nothing
  // armed. In the 320 x 568, 200% cell the same read is also taken at normal text at 320 x 568 and at
  // 375 x 667 (the pick was drawn at normal text), then the cell's size and mode are put back; the
  // sweep sets the next cell's mode itself.
  problems.push(...tagSummary(`${tag} tags`, await readTagLines(dialog, 3)));
  // Plan 89.6-44 (D46): the dialog draws the viewer's (You) and Owner, the roster member's Admin and
  // the friend's Friend at every width (below md the name control's inline Friend, from md the row's
  // own), and the requested person's Pending below md only: from md Pending lives in the name's
  // popover, not on the row. md is asked of the browser (at 768 wide with text at 200% it matches;
  // with a 32px default font it does not).
  const fromMd = await page.evaluate(() => window.matchMedia('(min-width: 48rem)').matches);
  const wanted: Record<string, number> = { '(You)': 1, Owner: 1, Admin: 1, Friend: 1, ...(fromMd ? {} : { '⏳ Pending': 1 }) };
  problems.push(...(await stagedTagsMissing(dialog, wanted)).map((line) => `${tag}: ${line}`));
  if (cell.id === '320x568-dark-200') {
    await setTextMode(page, '100', `${tag} tags normal-text pass`);
    for (const size of [{ width: 320, height: 568 }, { width: 375, height: 667 }]) {
      await page.setViewportSize(size);
      await settleAnimations(dialog);
      await toDialogTop(dialog);
      problems.push(...tagSummary(`${tag} tags at ${size.width} x ${size.height}, normal text`, await readTagLines(dialog, 3)));
    }
    await page.setViewportSize({ width: cell.width, height: cell.height });
    await setTextMode(page, '200', `${tag} back to 200%`);
    await settleAnimations(dialog);
    await toDialogTop(dialog);
  }
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
  // DECISION Phase 89.6-19 (R05-event enforced again by the owner's hyphen ruling, 2026-11-25): this row had gone
  // pending under plan 89.6-34 (orchestrator decision D17 A), because at 768 wide, font32 the guest name
  // Featherstonehaugh-Cholmondeley breaks only at its hyphen and the split read then listed it split (every other cell,
  // and both page-zoom widths, held: CI run 45648738582). The owner ruled question D "a" (a break at a hyphen is fine),
  // chosen OVER restructuring the Participants chip row (its layout is the owner's own pick O-9c = B); the read now lists
  // such a break as ordinary wrapping, as for D18 and D20 in
  // e2e/support/largeTextSurfaces/members.ts ("D18 and D20 enforced again by the owner's hyphen ruling"), and the row is
  // back under plan 89.6-19, enforced. Changing this is a decision, not a cleanup.
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
  // AMENDED Phase 89.6-29 (D31 enforced again): plan 89.6-29 turned the row back on with its sweep of the game view, in
  // the commit before its fix of the Reviews header (so the row is shown red, then green), chosen OVER moving the row
  // to the game module (a row keeps its module; its reach and extras are here).
  { id: 'D31', census: 'D31', kind: 'dialog', owner: '89.6-29', status: 'enforced', reach: reachDeleteSession, extras: deleteSessionExtras },
];
