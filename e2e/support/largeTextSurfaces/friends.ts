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
import { EMOJI_NAME, THIRTY_LETTER_WORD } from '../wordLines';
import type { SurfaceRow } from './index';

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
// back (route.fetch is a read); the route is registered once per page, after the guard.
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
        const response = await route.fetch();
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

export const rows: SurfaceRow[] = [
  { id: 'R04', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', reach: reachFriends, answers: answerFriends([LONG_FRIEND, EMOJI_FRIEND, SHORT_FRIEND, NAMELESS_FRIEND]) },
  { id: 'R04-empty', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', state: 'no friends', reach: reachNoFriends, answers: answerFriends([]) },
  { id: 'R04-partial', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', state: 'a friend with no username', reach: reachFriends, answers: answerFriends([NAMELESS_FRIEND]), extras: namelessShownAsMember },
  { id: 'D02', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'enforced', reach: reachInvite, answers: answerPanel(PANEL_FRIENDS) },
  { id: 'D02-empty', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'enforced', state: 'no friends', reach: reachInviteEmpty, answers: answerPanel([]) },
  { id: 'D02-found', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'enforced', state: 'the found-person row', reach: reachInviteFound, answers: answerPanel(PANEL_FRIENDS, (url) => (isPersonSearch(url) ? FOUND_PERSON : undefined)) },
  { id: 'D03', census: 'D03', kind: 'dialog', owner: '89.6-21', status: 'enforced', reach: reachCreated, answers: answerPanel(PANEL_FRIENDS, (url) => (isCreatedGroupRead(url) ? [] : undefined)) },
  { id: 'O05', census: 'O05', kind: 'overlay', owner: '89.6-21', status: 'pending' },
];
