// Surface rows: Friends, the two invite panels and the member-name popover. Owner: plan 89.6-21.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE FRIEND LIST. The Friends page reads the accepted friendships; every R04 row answers that one
// read in the browser (answers, status 200), so the CI login's real friends are never touched and
// each row holds the names it means to read: the 30-letter word, the two-word name with its emoji,
// a short name, and one friend with no username (the E2 partial case, review M029). The request
// and sent lists stay real. Nothing on the page is pressed: Remove, Invite to Group and the
// checkboxes are read only, and the sweep's guard holds every write all the same.
import { expect, type Locator, type Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { scrubbedFetch } from '../scrubbedFetch';
import { EMOJI_NAME, THIRTY_LETTER_WORD } from '../wordLines';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';
import { stageNight } from './night';

type Friendship = { id: string; friend: { id: string; username: string | null } };

const friendship = (n: number, username: string | null): Friendship => ({
  id: `e2e-sweep-friend-${n}`,
  friend: { id: `8961a021-0000-4000-8000-00000000000${n}`, username },
});

const LONG_FRIEND = friendship(1, THIRTY_LETTER_WORD);
const EMOJI_FRIEND = friendship(2, EMOJI_NAME);
const SHORT_FRIEND = friendship(3, 'Dana');
const NAMELESS_FRIEND = friendship(4, null);

const isAcceptedList = (url: URL): boolean => url.pathname.endsWith('/friendships') && url.searchParams.get('status') === 'accepted';
const answerFriends = (list: Friendship[]) => (url: URL): unknown => (isAcceptedList(url) ? list : undefined);

/** Open the Friends page and wait for what the answered list shows: a friend row, or the empty line. */
async function openFriends(page: Page, shown: 'rows' | 'empty'): Promise<{ root: Locator }> {
  await page.goto('/friends');
  const root = page.locator('main');
  const waitFor = shown === 'rows' ? root.locator('[data-friend-row]').first() : root.getByText('No friends yet', { exact: true }).first();
  await waitFor.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(root);
  return { root };
}

const reachFriends: SurfaceRow['reach'] = (page) => openFriends(page, 'rows');
const reachNoFriends: SurfaceRow['reach'] = (page) => openFriends(page, 'empty');

// R04-partial (UI-SPEC E2 held-out, review M029): the friend with no username is shown as Member and
// its checkbox is named Select Member, the house fallback for a member with no name.
const namelessShownAsMember: SurfaceRow['extras'] = async (page) => {
  const row = page.locator(`[data-friend-row="${NAMELESS_FRIEND.id}"]`);
  const checkbox = row.getByRole('checkbox');
  const name = (await checkbox.getAttribute('aria-label')) ?? '';
  const shown = ((await row.locator('p').first().textContent()) ?? '').trim();
  expect(`${name} | ${shown}`, `R04-partial: the friend with no username reads checkbox '${name}', name '${shown}'`).toBe('Select Member | Member');
};

// R04 extras, the 320 x 568 dark 200% cell only (CI-01g, the Friends half): the tab strip scrolls
// there, so its end cue shows, and is gone once the strip is scrolled to its end
// (src/app/friends/page.js ("DECISION Phase 89.6-21 (strip-cue)")). Then, back at the start, the
// Requests tab is reached by keyboard (Tab from the Friends tab) and must sit as clear of the fades
// as the geometry allows (review M027 / M115). Last, the Requests label's distance to its tab's
// left and right edges is printed for plan 89.6-31 (UI-SPEC: Friends tab ring inside, as built;
// nothing changes here). The strip and the focus are put back for the cells after this one.
const CUE_CELL = '320x568-dark-200';
const friendsExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  if (cell.id !== CUE_CELL) return;
  const main = page.locator('main');
  const strip = main.locator('.overflow-x-auto').filter({ has: page.getByRole('button', { name: /^Requests/ }) }).first();
  const cue = (side: 'start' | 'end') => main.locator(`[data-strip-cue="${side}"]`);
  await expect(cue('end'), 'R04 CI-01g: the strip scrolls at 320 / 200% but shows no end cue').toBeVisible();
  await expect(cue('start'), 'R04 CI-01g: a start cue shows while the strip is at its start').toHaveCount(0);
  await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(cue('end'), 'R04 CI-01g: the end cue stays after the strip reached its end').toHaveCount(0);
  await expect(cue('start'), 'R04 CI-01g: no start cue once the strip is scrolled from its start').toBeVisible();
  await strip.evaluate((el) => el.scrollTo({ left: 0 }));
  await expect(cue('start'), 'R04 CI-01g: the start cue stays after the strip went back to its start').toHaveCount(0);

  const friendsTab = main.getByRole('button', { name: /^Friends/ }).first();
  const requestsTab = main.getByRole('button', { name: /^Requests/ }).first();
  await friendsTab.focus();
  await page.keyboard.press('Tab');
  await expect(requestsTab, 'R04 CI-01g: Tab from the Friends tab did not reach Requests').toBeFocused();
  const coverage = () =>
    requestsTab.evaluate(async (tab) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const t = tab.getBoundingClientRect();
      const box = (tab.closest('.overflow-x-auto') as HTMLElement).getBoundingClientRect();
      const cues = Array.from(document.querySelectorAll('[data-strip-cue]')).map((el) => el.getBoundingClientRect());
      const covered = cues.reduce((sum, c) => sum + Math.max(0, Math.min(t.right, c.right) - Math.max(t.left, c.left)), 0);
      const cueWidth = cues[0]?.width ?? 32;
      const allowed = Math.max(0, t.width - (box.width - 2 * cueWidth)) + 0.5;
      return { covered, allowed };
    });
  await expect
    .poll(async () => {
      const read = await coverage();
      return read.covered <= read.allowed ? 'clear' : `covered ${read.covered}px, allowed ${read.allowed}px`;
    }, { message: 'R04 CI-01g: the keyboard-focused Requests tab stays under the edge cue' })
    .toBe('clear');

  const gaps = await requestsTab.evaluate((tab) => {
    const text = Array.from(tab.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '') as Text;
    const range = document.createRange();
    range.selectNodeContents(text);
    const label = range.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return { left: r2(label.left - t.left), right: r2(t.right - label.right) };
  });
  // Read by plan 89.6-31 from the CI log: the label-to-edge gaps of the focused Requests tab.
  process.stdout.write(`89.6-21 R04 Requests tab gaps at ${CUE_CELL}: label to left edge ${gaps.left}px, label to right edge ${gaps.right}px\n`);
  await requestsTab.evaluate((tab) => (tab as HTMLElement).blur());
  await strip.evaluate((el) => el.scrollTo({ left: 0 }));
};

// THE INVITE PANEL (D02, D03). D02 is Invite Members, opened from Home's first group card as
// e2e/friend-invite-panel-header.spec.ts does; D03 is the same panel opened by a group create
// ("<name> is live"). The panel's header is plan 89.6-10's; these rows read its body. The panel
// reads the invite token on open, a GET that writes, so every panel row answers it with a made-up
// link (answers). The root is the dialog, returned as the dialog so the sweep settles its box.
const INVITE_LINK = { invite_url: 'http://localhost:3000/invite/e2e-sweep-89-6-21' };
const isInviteToken = (url: URL): boolean => /\/groups\/[^/]+\/invite-token$/.test(url.pathname);
// The group the D03 create is answered with. It exists only in the browser.
const CREATED_GROUP = { id: '8961a021-0000-4000-8000-0000000000c3', name: THIRTY_LETTER_WORD };
const isCreatedGroupRead = (url: URL): boolean => url.pathname.endsWith(`/groups/${CREATED_GROUP.id}/users`);
// The person the D02-found lookup is answered with: not a friend, not the viewer.
const FOUND_PERSON = { id: '8961a021-0000-4000-8000-0000000000f2', username: EMOJI_NAME };
const isPersonSearch = (url: URL): boolean => url.pathname.endsWith('/friendships/search');

const answerPanel = (list: Friendship[], extra?: (url: URL) => unknown) => (url: URL): unknown => {
  if (isInviteToken(url)) return INVITE_LINK;
  if (isAcceptedList(url)) return list;
  return extra?.(url);
};

const panelDialog = (page: Page, name: RegExp): Locator => page.getByRole('dialog', { name });

/** Home, then the first group card's invite button; waits for what the friend list shows. */
async function openInvitePanel(page: Page, shown: 'rows' | 'empty'): Promise<Locator> {
  await page.goto('/');
  const invite = page.getByRole('button', { name: /invite member to/i }).first();
  await invite.waitFor({ state: 'visible', timeout: 15_000 });
  await invite.click();
  const dialog = panelDialog(page, /^Invite Members/);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  const waitFor = shown === 'rows' ? dialog.getByText(SHORT_FRIEND.friend.username ?? '', { exact: true }) : dialog.getByText('No friends yet.', { exact: true });
  await waitFor.first().waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return dialog;
}

// D02: one answered friend (the emoji name) is shown as already in the group, so the In group tag
// is read too. The group's own members read is let through and the friend added to what comes
// back (a read, passed through scrubbedFetch); the route is registered once per page, after the guard.
const inGroupRouted = new WeakSet<Page>();
const reachInvite: SurfaceRow['reach'] = async (page) => {
  if (!inGroupRouted.has(page)) {
    inGroupRouted.add(page);
    await page.route(
      (url) => /\/groups\/[^/]+\/users$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        const response = await scrubbedFetch(route);
        const body = (await response.json().catch(() => null)) as unknown;
        const member = { id: EMOJI_FRIEND.friend.id, username: EMOJI_NAME };
        const json = Array.isArray(body) ? [...body, member] : body && typeof body === 'object' && Array.isArray((body as { members?: unknown }).members) ? { ...(body as object), members: [...(body as { members: unknown[] }).members, member] } : body;
        await route.fulfill({ response, json });
      },
    );
  }
  const dialog = await openInvitePanel(page, 'rows');
  await dialog.getByText('In group', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  return { root: dialog, dialog };
};

// D02-empty: the friend list answered empty; the panel's own "No friends yet." line.
const reachInviteEmpty: SurfaceRow['reach'] = async (page) => {
  const dialog = await openInvitePanel(page, 'empty');
  return { root: dialog, dialog };
};

// D02-found: an address is sent and the person lookup answered with the emoji name, so the
// found-person row and Add Friend render. The invite send is a POST: it is FULFILLED in the browser
// by a route registered here, after the guard, so it runs first and the write never leaves the
// browser (the e2e/friend-invite-panel-header.spec.ts ("R4 D2 (88.9-52)") pattern). Add Friend is never pressed.
const sendRouted = new WeakSet<Page>();
const reachInviteFound: SurfaceRow['reach'] = async (page) => {
  if (!sendRouted.has(page)) {
    sendRouted.add(page);
    await page.route(
      (url) => url.pathname.endsWith('/invites/send'),
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 200, json: {} });
      },
    );
  }
  const dialog = await openInvitePanel(page, 'rows');
  await dialog.getByRole('textbox', { name: 'Invite by Email' }).fill('e2e-sweep-89-6-21@example.test');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.locator('[data-add-friend-prompt]').waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  // The found-person row makes the panel taller than the 215 / 187 page-zoom window and the Send
  // press scrolls the dialog down; the read is taken from the dialog's top, as plan 25's rows are (89.6-21 B, D22).
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D03: Create a new Group with the 30-letter name; the create POST is FULFILLED in the browser by a
// route registered here, after the guard, so it runs first and the write never leaves the browser.
// The matcher is home.ts's (the BFF path). The panel then opens as "<name> is live".
const isCreateGroup = (url: URL): boolean => url.pathname === '/api/groups';
const createRouted = new WeakSet<Page>();
const reachCreated: SurfaceRow['reach'] = async (page) => {
  if (!createRouted.has(page)) {
    createRouted.add(page);
    await page.route(isCreateGroup, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, json: CREATED_GROUP });
    });
  }
  await page.goto('/');
  await page.getByRole('heading', { level: 2, name: 'Your Groups' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Create new group' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create a new Group', exact: true });
  await create.waitFor({ state: 'visible', timeout: 15_000 });
  await create.getByRole('textbox', { name: 'Group Name' }).fill(THIRTY_LETTER_WORD);
  await create.getByRole('button', { name: 'Create Group', exact: true }).click();
  const dialog = panelDialog(page, /is live/);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByText(SHORT_FRIEND.friend.username ?? '', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return { root: dialog, dialog };
};

const PANEL_FRIENDS = [LONG_FRIEND, EMOJI_FRIEND, SHORT_FRIEND, NAMELESS_FRIEND];

// THE MEMBER POPOVER (O05). The name popover is the desktop path (a phone shows the inline indicator
// instead, census O05), so the row is reached at 1280 x 800 and each cell then resizes the window
// with the popover open. It opens on the night page, staged as plan 89.6-19's R05-event row stages
// it (e2e/support/largeTextSurfaces/night.ts ("export async function stageNight")): that page is as
// wide as the window at 320 / 200%, and the cells read page sideways document-wide. The night's
// RSVP read is answered here, after the staging, so it runs first: the group's real members as yes,
// plus one person with the 30-letter name who is nobody's friend (status none), so their popover
// offers Add friend. The popover is opened from the keyboard (focus the name, Enter), which keeps it
// open until Escape or a press elsewhere; a hover-opened one could close when a resize moves the
// name from under a still pointer. Add friend is never pressed.
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the popover row opens that group night');
  return id;
};
const eventPath = (): string => process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${groupId()}`;
const eventId = (): string => new URL(eventPath(), 'http://localhost').searchParams.get('event_id') ?? '1';
const STRANGER = { id: '8961a021-0000-4000-8000-0000000000a5', username: THIRTY_LETTER_WORD };
const rsvpRouted = new WeakSet<Page>();
const reachPopover: SurfaceRow['reach'] = async (page) => {
  await stageNight(page);
  if (!rsvpRouted.has(page)) {
    rsvpRouted.add(page);
    const id = eventId();
    await page.route(
      (url) => url.pathname === `/api/rsvp/event/${id}`,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        const roster = await scrubbedFetch(route, { url: new URL(`/api/groups/${groupId()}/users`, route.request().url()).toString() });
        const body = (await roster.json().catch(() => [])) as unknown;
        const members = (Array.isArray(body) ? body : []) as Array<{ id?: unknown; username?: string | null }>;
        const row = (n: number, userId: string, username: string) => ({ id: `8961a021-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, event_id: id, user_id: userId, status: 'yes', note: null, User: { id: userId, username } });
        const rsvps = [...members.filter((m) => typeof m.id === 'string').map((m, n) => row(n, m.id as string, m.username ?? 'Member')), row(99, STRANGER.id, STRANGER.username)];
        await route.fulfill({ json: { rsvps, summary: { yes: rsvps.length, maybe: 0, no: 0 } } });
      },
    );
  }
  await page.goto(eventPath());
  const name = page.getByRole('main').getByRole('button', { name: THIRTY_LETTER_WORD, exact: true }).first();
  await name.waitFor({ state: 'visible', timeout: 15_000 });
  await name.focus();
  await page.keyboard.press('Enter');
  const popover = page.locator('[data-member-popover]').first();
  await popover.getByRole('button', { name: 'Add friend', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(popover);
  return { root: popover };
};

// O05 extras, every cell: the popover's Add friend keeps the 44px floor (P4: a floor miss is fixed,
// never accepted), and the popover stays open through the resize.
const popoverExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const add = await page.locator('[data-member-popover]').first().getByRole('button', { name: 'Add friend', exact: true }).boundingBox();
  if (!add) throw new Error(`O05 ${cell.id}: the popover or its Add friend is gone after the resize`);
  if (add.height < 44 - 0.5) throw new Error(`O05 ${cell.id}: Add friend is ${add.height}px tall, under the 44px floor`);
};

export const rows: SurfaceRow[] = [
  { id: 'R04', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', reach: reachFriends, answers: answerFriends([LONG_FRIEND, EMOJI_FRIEND, SHORT_FRIEND, NAMELESS_FRIEND]), extras: friendsExtras },
  { id: 'R04-empty', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', state: 'no friends', reach: reachNoFriends, answers: answerFriends([]) },
  { id: 'R04-partial', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', state: 'a friend with no username', reach: reachFriends, answers: answerFriends([NAMELESS_FRIEND]), extras: namelessShownAsMember },
  { id: 'D02', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'enforced', reach: reachInvite, answers: answerPanel(PANEL_FRIENDS) },
  { id: 'D02-empty', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'enforced', state: 'no friends', reach: reachInviteEmpty, answers: answerPanel([]) },
  { id: 'D02-found', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'enforced', state: 'the found-person row', reach: reachInviteFound, answers: answerPanel(PANEL_FRIENDS, (url) => (isPersonSearch(url) ? FOUND_PERSON : undefined)) },
  { id: 'D03', census: 'D03', kind: 'dialog', owner: '89.6-21', status: 'enforced', reach: reachCreated, answers: answerPanel(PANEL_FRIENDS, (url) => (isCreatedGroupRead(url) ? [] : undefined)) },
  { id: 'O05', census: 'O05', kind: 'overlay', owner: '89.6-21', status: 'enforced', reachAt: { width: 1280, height: 800 }, reach: reachPopover, extras: popoverExtras },
];
