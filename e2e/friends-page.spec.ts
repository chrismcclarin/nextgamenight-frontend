// Phase 88.6.1-40 (Req 7 / AC-23; Req 4 / D-35; Req 8 / D-22) — the Friends page's tab strip and
// its Invite to Group button in a real browser, in BOTH projects (`phone` at 375 and `journeys`).
//
// What this proves:
//   1. the keyboard-focused Friends tab paints the house OUTSET ring (a non-inset box-shadow with
//      a 4px spread: Tailwind 4.3.3 composes `ring-2` + `ring-offset-2` into a 2px offset shadow
//      and a `0 0 0 calc(2px + 2px)` ring shadow, probed against the installed compiler), the
//      tab's label text lies inside the tab's box, its count pill lies inside the ring's inner
//      edge (the box plus the 2px offset), and once focus moves on the 4px spread is gone;
//   2. Invite to Group pressed by keyboard (Enter twice) sends exactly ONE invite POST, keeps
//      focus, carries aria-disabled (never the native attribute) at full opacity once the batch
//      settled, and the outcome is shown in the always-mounted polite region.
//
// The invite POST is answered in the browser with `page.route`, so CI never creates a pending
// invite: the fixture friends are shared with `invite.spec.ts`, whose journey needs each one
// first-use (that is why it keeps per-project friends). Selectors are role, label or id only,
// never Tailwind classes. Assertion messages carry numbers only, never personal data.
//
// It runs in CI only: both projects need the `.auth` storage state, which does not exist locally.
// The jsdom pins in `src/app/friends/page.test.tsx` are the RED halves.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

const INVITE_ROUTE = '**/invites/send';
const RING_SPREAD = '0px 0px 0px 4px';

function friendsTab(page: Page): Locator {
  // The tab's name is its label plus its count pill, e.g. "Friends" or "Friends 3".
  return page.getByRole('button', { name: /^Friends\s*\d*$/ });
}

async function boxShadow(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).boxShadow);
}

test.describe('friends page tab ring and Invite to Group (Phase 88.6.1-40)', () => {
  test('the keyboard-focused Friends tab paints an outset ring clear of its label, gone once blurred', async ({
    page,
  }) => {
    await page.goto('/friends');
    const email = page.getByLabel("Friend's email address");
    await expect(email).toBeVisible({ timeout: 15_000 });
    await email.focus();
    // Search is natively disabled while the field is empty, so Tab lands on the Friends tab.
    await page.keyboard.press('Tab');
    const tab = friendsTab(page);
    await expect(tab).toBeFocused();

    const focused = await boxShadow(tab);
    expect(focused, 'the focused tab paints a 4px ring spread').toContain(RING_SPREAD);
    expect(focused, 'the ring is outset, never inset').not.toContain('inset');

    const geometry = await tab.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const label = Array.from(el.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== ''
      );
      const range = document.createRange();
      if (label) range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const pill = el.querySelector('span');
      const pillBox = pill ? pill.getBoundingClientRect() : null;
      const toPlain = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      return {
        hasLabel: Boolean(label),
        box: toPlain(box),
        text: toPlain(text),
        pill: pillBox ? toPlain(pillBox) : null,
      };
    });
    expect(geometry.hasLabel, 'the tab has a text label').toBe(true);
    const { box, text, pill } = geometry;
    // Non-strict: the label may touch the box edge; the outset ring is drawn outside the box.
    expect(text.left, `label left ${text.left} vs box left ${box.left}`).toBeGreaterThanOrEqual(box.left);
    expect(text.right, `label right ${text.right} vs box right ${box.right}`).toBeLessThanOrEqual(box.right);
    expect(text.top, `label top ${text.top} vs box top ${box.top}`).toBeGreaterThanOrEqual(box.top);
    expect(text.bottom, `label bottom ${text.bottom} vs box bottom ${box.bottom}`).toBeLessThanOrEqual(box.bottom);
    if (pill) {
      // The ring starts 2px outside the box (ring-offset-2), so the pill is clear of it while it
      // stays inside the box widened by those 2px.
      expect(pill.left, `pill left ${pill.left} vs ring inner edge ${box.left - 2}`).toBeGreaterThanOrEqual(box.left - 2);
      expect(pill.right, `pill right ${pill.right} vs ring inner edge ${box.right + 2}`).toBeLessThanOrEqual(box.right + 2);
      expect(pill.top, `pill top ${pill.top} vs ring inner edge ${box.top - 2}`).toBeGreaterThanOrEqual(box.top - 2);
      expect(pill.bottom, `pill bottom ${pill.bottom} vs ring inner edge ${box.bottom + 2}`).toBeLessThanOrEqual(box.bottom + 2);
    }

    // Positive control: focus moves on, and the Friends tab no longer paints the ring.
    await page.keyboard.press('Tab');
    await expect(tab).not.toBeFocused();
    expect(await boxShadow(tab), 'no 4px ring spread once blurred').not.toContain(RING_SPREAD);
  });

  test('Invite to Group pressed twice by keyboard sends one invite, keeps focus and shows the outcome', async ({
    page,
  }, testInfo) => {
    const groupName = process.env.E2E_INVITE_GROUP_NAME ?? 'E2E Invite Group';
    // The same per-project fixture friends `invite.spec.ts` uses.
    const friendName =
      testInfo.project.name === 'phone'
        ? process.env.E2E_INVITE_FRIEND_NAME_PHONE ?? 'Charlie'
        : process.env.E2E_INVITE_FRIEND_NAME ?? 'Bob';

    let posts = 0;
    await page.route(INVITE_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      posts += 1;
      // Held long enough for the second Enter to land while the first is in flight.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/friends');
    await expect(page.getByText(friendName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    const groupSelect = page.getByRole('combobox', { name: /invite to group/i });
    await expect(groupSelect).toBeVisible({ timeout: 15_000 });

    // Invite to Group refuses a press while the chosen group's members load, so wait for that
    // load's response (a positive signal) before checking the friend.
    const membersLoaded = page.waitForResponse(
      (response) => /\/groups\/[^/]+\/users/.test(response.url()) && response.request().method() === 'GET'
    );
    await groupSelect.selectOption({ label: groupName });
    await membersLoaded;
    await page.getByRole('checkbox', { name: new RegExp(`select ${friendName}`, 'i') }).check();

    const invite = page.getByRole('button', { name: /invite to group/i });
    await expect(invite, 'Invite to Group is pressable once a friend is checked').not.toHaveAttribute('aria-disabled', 'true');
    await invite.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await expect(page.locator('#friends-batch-status')).toHaveText(/invited 1 friend/i, { timeout: 15_000 });
    expect(posts, `two Enter presses in one flight send exactly one invite POST (got ${posts})`).toBe(1);
    await expect(invite, 'the pressed button keeps focus after the outcome').toBeFocused();
    await expect(invite, 'gated by aria-disabled once the selection cleared').toHaveAttribute('aria-disabled', 'true');
    await expect(invite, 'never the native disabled attribute').not.toHaveAttribute('disabled');
    const opacity = await invite.evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity, `computed opacity ${opacity}`).toBe('1');
  });
});

// Phase 88.6.1-72 (owner rulings 2026-10-05; plan 88.6.1-70 contract C8 d) — what the Requests tab
// and the friend batch say, in BOTH projects (`phone` at 375 and `journeys`):
//   (3) a failed requests load shows FR1 inside the viewport, never the empty line, and Try again
//       brings the rows back with focus on the Requests tab;
//   (4) a failed Accept shows its alert line inside the viewport while the row stays and the
//       pressed Accept keeps focus;
//   (5) a failed refresh over a remaining request shows RF1 above it (C8 d), and a successful Retry
//       lands focus on the Requests tab;
//   (6) a batch answered 409 `invite_pending` shows the already-invited line inside the viewport.
// Every write is held (support/inFlight.ts) and every POST these tests make is FULFILLED in the
// browser, never continued, so the shared CI database is never written; the received and accepted
// list GETs are answered with synthetic rows, so the fixture friends stay as they are. Routes match
// on a URL predicate (never a glob with a `?`), registered before navigation, and switch on a
// test-owned flag, never a call count (the provider and the page both read these lists, in an order
// the test does not own). The tests never answer 401 / 403: the access-answer and tab-return focus
// cases are jsdom only (src/app/friends/page.test.tsx Q6, Q8). A failed 375px layout assertion is a
// STOP for the owner's mockup, never a restyle. They run in CI only (no `.auth` locally).

// Copy row RF1 / D-47 (plan 88.6.1-70's REFRESH_FAILED_NOTICE, contract C7), written once in this spec.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
// Copy row FR1 (owner ruling 2026-10-05).
const FR1 = "Couldn't load your friend requests";

const REQUESTER_FR1 = { id: 'e2e-friends-fr1', Requester: { id: '8861a072-0000-4000-8000-0000000000a1', username: 'E2E Requester' } };
const REQUESTER_A = { id: 'e2e-friends-rf1-a', Requester: { id: '8861a072-0000-4000-8000-0000000000a2', username: 'E2E Requester A' } };
const REQUESTER_B = { id: 'e2e-friends-rf1-b', Requester: { id: '8861a072-0000-4000-8000-0000000000a3', username: 'E2E Requester B' } };

const isFriendshipList = (url: URL, key: 'status' | 'direction', value: string) =>
  url.pathname.endsWith('/friendships') && url.searchParams.get(key) === value;
const isReceivedList = (url: URL) => isFriendshipList(url, 'direction', 'received');

function requestsTab(page: Page): Locator {
  return page.getByRole('button', { name: /^Requests\s*\d*$/ });
}

// The RF1 notice's VISIBLE line: the sentence is rendered twice (the sr-only polite region and the
// visible span), and an sr-only node still has a box, so `.and(locator('span'))` keeps only the
// visible one (plan 88.6.1-73's CI fix, run 39005519001).
function rf1Line(page: Page): Locator {
  return page.getByText(RF1, { exact: true }).and(page.locator('span'));
}

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} has no layout box`).not.toBeNull();
  return box!;
}

// "Inside the viewport": the box's right edge at most the viewport width, its left edge at least 0.
async function expectInsideViewport(page: Page, locator: Locator, what: string) {
  const box = await boxOf(locator, what);
  const width = page.viewportSize()?.width ?? 0;
  expect(box.x, `${what} left edge ${box.x}px`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what} right edge ${box.x + box.width}px vs viewport ${width}px`).toBeLessThanOrEqual(width);
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `the page scrolls sideways: ${scrollWidth}px vs ${innerWidth}px`).toBeLessThanOrEqual(innerWidth);
}

// Answers the received-list GET with whatever `answer()` returns at the time of the request.
async function routeReceived(page: Page, answer: () => { status: number; json: unknown }) {
  await page.route(isReceivedList, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const { status, json } = answer();
    await route.fulfill({ status, json });
  });
}

// Fulfils (never continues) the accept POST for one request id, counting the posts.
async function routeAccept(page: Page, requestId: string, status: number, onFulfil?: () => void) {
  const posts = { count: 0 };
  await page.route(
    (url) => url.pathname.endsWith(`/friendships/${requestId}/accept`),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      posts.count += 1;
      onFulfil?.();
      await route.fulfill({ status, json: {} });
    },
  );
  return posts;
}

async function openRequests(page: Page) {
  await page.goto('/friends');
  const tab = requestsTab(page);
  // The identity gate renders first.
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  return tab;
}

test.describe('friends page — what the Requests tab and the batch say (88.6.1-72)', () => {
  let hold: WriteHold | undefined;
  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any mock and before navigation, so it is the last resort.
    hold = await holdWrites(page);
  });
  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('(3) a failed requests load shows FR1 inside the viewport, never the empty line; Try again brings the rows back and lands on the tab', async ({ page }) => {
    let failReceived = true;
    await routeReceived(page, () => (failReceived ? { status: 500, json: {} } : { status: 200, json: [REQUESTER_FR1] }));
    const tab = await openRequests(page);

    const title = page.getByText(FR1, { exact: true });
    await expect(title).toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page, title, 'the FR1 title');
    await expect(page.getByText('No pending friend requests.')).toHaveCount(0);

    failReceived = false;
    const tryAgain = page.getByRole('button', { name: /Try again/ });
    await tryAgain.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('E2E Requester', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(title).toHaveCount(0);
    await expect(tab).toBeFocused();
  });

  test('(4) a failed Accept shows its alert line inside the viewport; the row stays and the pressed Accept keeps focus', async ({ page }) => {
    await routeReceived(page, () => ({ status: 200, json: [REQUESTER_FR1] }));
    const posts = await routeAccept(page, REQUESTER_FR1.id, 500);
    await openRequests(page);
    await expect(page.getByText('E2E Requester', { exact: true })).toBeVisible({ timeout: 15_000 });

    const accept = page.getByRole('button', { name: 'Accept', exact: true });
    await accept.focus();
    await page.keyboard.press('Enter');

    // The page's own request-action line (a paragraph carrying the alert role).
    const line = page.locator('p[role="alert"]');
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line).not.toHaveText('');
    await expectInsideViewport(page, line, 'the request-action line');
    await expect(page.getByText('E2E Requester', { exact: true })).toBeVisible();
    await expect(accept).toBeFocused();
    expect(posts.count, `one Enter sends exactly one accept POST (got ${posts.count})`).toBe(1);
  });

  test('(5) a failed refresh keeps the remaining request under RF1, in place at 375 (C8 d); Retry brings it back and lands on the tab', async ({ page }, testInfo) => {
    let acceptFulfilled = false;
    let healReceived = false;
    await routeReceived(page, () => {
      if (!acceptFulfilled) return { status: 200, json: [REQUESTER_A, REQUESTER_B] };
      if (!healReceived) return { status: 500, json: {} };
      return { status: 200, json: [REQUESTER_B] };
    });
    await routeAccept(page, REQUESTER_A.id, 200, () => {
      acceptFulfilled = true;
    });
    const tab = await openRequests(page);
    const rowB = page.getByText('E2E Requester B', { exact: true });
    await expect(rowB).toBeVisible({ timeout: 15_000 });

    // A's Accept: confirmed, so the provider removes A and loads again; that load fails.
    await page
      .getByRole('button', { name: 'Accept', exact: true })
      .first()
      .click();
    const line = rf1Line(page);
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line).toHaveCount(1);
    await expect(rowB).toBeVisible();
    await expect(page.getByText(FR1, { exact: true })).toHaveCount(0);

    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await settleAnimations(page.locator('main'));
    await expectInsideViewport(page, line, 'the RF1 line');
    await expectInsideViewport(page, retry, 'the RF1 Retry');
    await expectNoSidewaysScroll(page);
    const lineBox = await boxOf(line, 'the RF1 line');
    const rowBox = await boxOf(rowB, 'the remaining request');
    expect(lineBox.y, `the notice starts at ${lineBox.y}px; the request at ${rowBox.y}px`).toBeLessThan(rowBox.y);
    if (testInfo.project.name === 'phone') {
      // C8 (d): the 44 floor is the phone's (the row's desktop height is plan 70's, not measured here).
      expect(page.viewportSize()?.width).toBe(375);
      const retryBox = await boxOf(retry, 'the RF1 Retry');
      expect(retryBox.width, `Retry measured ${retryBox.width}px wide`).toBeGreaterThanOrEqual(44);
      expect(retryBox.height, `Retry measured ${retryBox.height}px tall`).toBeGreaterThanOrEqual(44);
    }

    healReceived = true;
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    await expect(rowB).toBeVisible();
    await expect(tab).toBeFocused();
  });

  test('(6) a batch answered 409 invite_pending shows the already-invited line inside the viewport, never a failure', async ({ page }, testInfo) => {
    const groupName = process.env.E2E_INVITE_GROUP_NAME ?? 'E2E Invite Group';
    // The same per-project fixture friends `invite.spec.ts` uses (plan 40's test above).
    const friendName =
      testInfo.project.name === 'phone'
        ? process.env.E2E_INVITE_FRIEND_NAME_PHONE ?? 'Charlie'
        : process.env.E2E_INVITE_FRIEND_NAME ?? 'Bob';
    await page.route(INVITE_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 409,
        json: { code: 'invite_pending', message: 'This person already has a pending invite' },
      });
    });

    await page.goto('/friends');
    await expect(page.getByText(friendName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    const groupSelect = page.getByRole('combobox', { name: /invite to group/i });
    await expect(groupSelect).toBeVisible({ timeout: 15_000 });
    const membersLoaded = page.waitForResponse(
      (response) => /\/groups\/[^/]+\/users/.test(response.url()) && response.request().method() === 'GET'
    );
    await groupSelect.selectOption({ label: groupName });
    await membersLoaded;
    await page.getByRole('checkbox', { name: new RegExp(`select ${friendName}`, 'i') }).check();
    const invite = page.getByRole('button', { name: /invite to group/i });
    await expect(invite).not.toHaveAttribute('aria-disabled', 'true');
    await invite.focus();
    await page.keyboard.press('Enter');

    const status = page.locator('#friends-batch-status');
    await expect(status).toHaveText('Everyone selected was already invited or a member', { timeout: 15_000 });
    await expectInsideViewport(page, status, 'the batch line');
    await expect(page.locator('#friends-batch-error')).toHaveText('');
  });
  test('(7) a failed friends refresh keeps the friend under RF1, in place at 375 (C8 d); Retry brings it back and lands on the Friends tab', async ({ page }, testInfo) => {
    const friend = { id: 'e2e-friends-fr-1', friend: { id: '8861a072-0000-4000-8000-0000000000a4', username: 'E2E Friend' } };
    const request = { id: 'e2e-friends-rf1-f', Requester: { id: '8861a072-0000-4000-8000-0000000000a5', username: 'E2E Requester F' } };
    let acceptFulfilled = false;
    let healFriends = false;
    await page.route(
      (url) => isFriendshipList(url, 'status', 'accepted'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        if (acceptFulfilled && !healFriends) {
          await route.fulfill({ status: 500, json: {} });
          return;
        }
        await route.fulfill({ status: 200, json: [friend] });
      },
    );
    await routeReceived(page, () => ({ status: 200, json: [request] }));
    await routeAccept(page, request.id, 200, () => {
      acceptFulfilled = true;
    });
    await openRequests(page);
    await expect(page.getByText('E2E Requester F', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Accept', exact: true }).click();

    const tab = friendsTab(page);
    await tab.click();
    const line = rf1Line(page);
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line).toHaveCount(1);
    const row = page.getByText('E2E Friend', { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText("Couldn't load your friends", { exact: true })).toHaveCount(0);

    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await settleAnimations(page.locator('main'));
    await expectInsideViewport(page, line, 'the RF1 line');
    await expectInsideViewport(page, retry, 'the RF1 Retry');
    await expectNoSidewaysScroll(page);
    const lineBox = await boxOf(line, 'the RF1 line');
    const rowBox = await boxOf(row, 'the retained friend');
    expect(lineBox.y, `the notice starts at ${lineBox.y}px; the friend at ${rowBox.y}px`).toBeLessThan(rowBox.y);
    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
      const retryBox = await boxOf(retry, 'the RF1 Retry');
      expect(retryBox.width, `Retry measured ${retryBox.width}px wide`).toBeGreaterThanOrEqual(44);
      expect(retryBox.height, `Retry measured ${retryBox.height}px tall`).toBeGreaterThanOrEqual(44);
    }

    healFriends = true;
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(line).toHaveCount(0, { timeout: 15_000 });
    await expect(row).toBeVisible();
    await expect(tab).toBeFocused();
  });
});
