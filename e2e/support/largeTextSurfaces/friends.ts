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

export const rows: SurfaceRow[] = [
  { id: 'R04', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', reach: reachFriends, answers: answerFriends([LONG_FRIEND, EMOJI_FRIEND, SHORT_FRIEND, NAMELESS_FRIEND]) },
  { id: 'R04-empty', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', state: 'no friends', reach: reachNoFriends, answers: answerFriends([]) },
  { id: 'R04-partial', census: 'R04', kind: 'route', owner: '89.6-21', status: 'enforced', state: 'a friend with no username', reach: reachFriends, answers: answerFriends([NAMELESS_FRIEND]), extras: namelessShownAsMember },
  { id: 'D02', census: 'D02', kind: 'dialog', owner: '89.6-21', status: 'pending' },
  { id: 'D03', census: 'D03', kind: 'dialog', owner: '89.6-21', status: 'pending' },
  { id: 'O05', census: 'O05', kind: 'overlay', owner: '89.6-21', status: 'pending' },
];
