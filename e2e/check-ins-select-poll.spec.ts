import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';

// quick-261026-pi6 (owner R1-R5, 2026-10-26): selecting a poll on the group planning page, in a
// real browser at 375 x 667 (the phone project only).
//
// WHAT IT PROVES (what jsdom cannot):
// - S1: a tap on a check-in card body selects that poll: the card is pressed and wears its 2px
//   link-colour border and Viewing tag, the URL gains poll=<id>, the Showing line and the
//   dashboard switch to it, and the Poll Responses heading is focused, in the viewport and NOT
//   under the 64px sticky header (scroll margin). The body clears 44px; the page gains no
//   horizontal overflow; the open-polls GET ran once (the chips read the shared cache).
// - S2: the swap is in place. Next 14.2.35 turns the native pushState into a router restore, so
//   no document navigation and no server-component request happen, a window marker survives, and
//   history.back() steps back to the previous poll (src/app/groupPlanning/page.js ("searchParams.get('poll')")).
// - S3: with two open polls the Switch poll chips swap without scrolling and keep focus.
// - S4: the kebab is the card's sibling: opening it selects nothing.
// - S5: a shared link opens its poll; an unknown poll id falls back to the active poll, drops the
//   parameter and shows no error banner; a malformed poll id drops before a tap, so back after
//   the tap returns to the active poll with no poll parameter (quick-261026-pi6-fix F16); and a
//   poll whose starter's name is 50 unbroken characters, once selected, does not push the page
//   sideways (the Showing line's wrap-anywhere, quick-261026-pi6-fix F14).
//
// IT NEVER WRITES TO THE BACKEND. Every route below answers GETs in the browser with two synthetic
// polls (fixed UUIDs no seeded row owns); any other method falls back, and the shared write hold
// (holdWrites, registered first so it is the last resort) keeps any write in the browser. No real
// poll is started or ended. The CI seed's own open polls are never read: the open-polls, active,
// by-id and respondents GETs are all answered here.
//
// CI ONLY: the phone project needs .auth/user.json and the E2E login secrets, which exist only in
// CI (FE-TESTING-CONVENTIONS C-14). Every comment here is a // line.

// Loud guard (precedent e2e/check-ins-end-focus.spec.ts): name the var and its producer, never echo
// the value.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this spec opens a group the fixtures do not own.',
  ).toBeTruthy();
});

const POLL_A_ID = '26102600-0000-4000-8000-0000000000a1';
const POLL_B_ID = '26102600-0000-4000-8000-0000000000a2';
// Answered 404 by the by-id route below (S5).
const UNKNOWN_POLL_ID = '26102600-0000-4000-8000-0000000000ff';
// Listed only when routeState.withLongName is set (S5, F14): a starter name of 50 characters with
// no break opportunity.
const POLL_LONG_ID = '26102600-0000-4000-8000-0000000000a3';
const LONG_STARTER = `E2E${'x'.repeat(47)}`;

const MEMBER_A = 'E2E pending member A';
const MEMBER_B = 'E2E pending member B';

function syntheticPoll(id: string, username: string, creatorId: string) {
  return {
    id,
    status: 'active',
    group_id: E2E_GROUP_ID,
    can_close: true,
    custom_message: null,
    blind_voting_enabled: false,
    deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    Creator: { id: creatorId, username },
  };
}

const POLLS = {
  [POLL_A_ID]: syntheticPoll(POLL_A_ID, 'E2E Ana', '26102600-0000-4000-8000-0000000000b1'),
  [POLL_B_ID]: syntheticPoll(POLL_B_ID, 'E2E Ben', '26102600-0000-4000-8000-0000000000b2'),
  [POLL_LONG_ID]: syntheticPoll(POLL_LONG_ID, LONG_STARTER, '26102600-0000-4000-8000-0000000000b3'),
} as Record<string, ReturnType<typeof syntheticPoll>>;

const RESPONDENTS: Record<string, { user_id: string; username: string }> = {
  [POLL_A_ID]: { user_id: '26102600-0000-4000-8000-0000000000c1', username: MEMBER_A },
  [POLL_B_ID]: { user_id: '26102600-0000-4000-8000-0000000000c2', username: MEMBER_B },
};

const routeState = { openGets: 0, withLongName: false };

// Every route answers GET only; anything else falls back to the write hold.
async function mockPolls(page: Page) {
  routeState.openGets = 0;
  routeState.withLongName = false;

  await page.route('**/api/groups/*/prompts/open', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    routeState.openGets += 1;
    const prompts = [POLLS[POLL_A_ID], POLLS[POLL_B_ID]];
    if (routeState.withLongName) prompts.push(POLLS[POLL_LONG_ID]);
    await route.fulfill({ status: 200, json: { prompts } });
  });

  await page.route(
    (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/prompts/active`),
    async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, json: { prompt: POLLS[POLL_A_ID] } });
    },
  );

  // GET /prompts/<id> by exact pathname end (never the groups routes above, which also end in
  // /prompts/<word>): A and B, anything else 404.
  await page.route(
    (url) => /\/prompts\/[^/]+$/.test(url.pathname) && !url.pathname.includes('/groups/'),
    async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      const prompt = POLLS[id];
      if (!prompt) {
        await route.fulfill({ status: 404, json: { error: 'Prompt not found' } });
        return;
      }
      await route.fulfill({ status: 200, json: { prompt } });
    },
  );

  // GET /prompts/<id>/respondents: one distinct pending member per poll.
  await page.route(
    (url) => /\/prompts\/[^/]+\/respondents$/.test(url.pathname),
    async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const id = new URL(route.request().url()).pathname.split('/').slice(-2)[0];
      const member = RESPONDENTS[id];
      await route.fulfill({
        status: 200,
        json: member ? [{ ...member, has_responded: false, slot_count: null, last_reminded_at: null }] : [],
      });
    },
  );
}

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

const cardBody = (page: Page, starter: string): Locator =>
  page.getByRole('button', { name: new RegExp(`Started by ${starter}`) });
const cardRow = (page: Page, starter: string): Locator =>
  page.getByRole('listitem').filter({ hasText: `Started by ${starter}` });
const pollResponsesHeading = (page: Page): Locator =>
  page.getByRole('heading', { level: 3, name: 'Poll Responses' });
const showingLine = (page: Page): Locator => page.locator('p').filter({ hasText: /^Showing / });
const switchPoll = (page: Page): Locator => page.getByRole('group', { name: 'Switch poll' });

async function openPlanning(page: Page, query = ''): Promise<void> {
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}${query}`);
  // A missing dashboard is a failure, never a skip (touch-targets.spec.ts idiom).
  await expect(pollResponsesHeading(page)).toBeVisible({ timeout: 15_000 });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `the page scrolls sideways (${scrollWidth}px over ${clientWidth}px)`).toBeLessThanOrEqual(clientWidth);
}

test('S1: tapping a card body selects its poll, swaps the dashboard and lands on Poll Responses below the header', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px selection proof is phone-only');
  await mockPolls(page);
  await openPlanning(page);
  await expect(showingLine(page)).toHaveText("Showing E2E Ana's check-in");

  const bodyA = cardBody(page, 'E2E Ana');
  const bodyB = cardBody(page, 'E2E Ben');
  await bodyB.tap();

  await expect(bodyB).toHaveAttribute('aria-pressed', 'true');
  await expect(bodyA).toHaveAttribute('aria-pressed', 'false');
  await expect(cardRow(page, 'E2E Ben').getByText('Viewing', { exact: true })).toBeVisible();
  await expect(cardRow(page, 'E2E Ana').getByText('Viewing', { exact: true })).toHaveCount(0);

  await expect.poll(() => new URL(page.url()).searchParams.get('poll')).toBe(POLL_B_ID);
  expect(new URL(page.url()).searchParams.get('group_id')).toBe(E2E_GROUP_ID);
  await expect(showingLine(page)).toHaveText("Showing E2E Ben's check-in");
  await expect(page.getByText(MEMBER_B)).toBeVisible();

  const heading = pollResponsesHeading(page);
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  // Not covered by the sticky header: the topmost element at the heading's centre is the heading
  // itself, polled until the smooth scroll settles.
  await expect
    .poll(() =>
      heading.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit) && el.contains(hit);
      }),
    )
    .toBe(true);

  const linkColour = await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Home' })
    .evaluate((el) => getComputedStyle(el).color);
  const rowB = await cardRow(page, 'E2E Ben').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.borderTopWidth, colour: cs.borderTopColor };
  });
  const rowA = await cardRow(page, 'E2E Ana').evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(rowB.width).toBe('2px');
  expect(rowB.colour, 'the selected border is the link colour token').toBe(linkColour);
  expect(rowA).toBe('1px');

  await expectTouchTarget(bodyB, "E2E Ben's card body");
  await expectNoHorizontalOverflow(page);
  expect(routeState.openGets, 'the open-polls GET ran once: the chips read the shared cache').toBe(1);
});

test('S2: a selection swaps in place, with no document or server-component request, and back steps to the previous poll', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px selection proof is phone-only');
  await mockPolls(page);
  await openPlanning(page);
  await expect(page.getByText(MEMBER_A)).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__pi6Marker = 'kept';
  });
  const marker = () => page.evaluate(() => (window as unknown as Record<string, unknown>).__pi6Marker);

  const navigations: string[] = [];
  const serverComponentRequests: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    const headers = request.headers();
    if (headers['rsc'] && !headers['next-router-prefetch'] && new URL(request.url()).pathname === '/groupPlanning') {
      serverComponentRequests.push(request.url());
    }
  });

  await cardBody(page, 'E2E Ben').tap();
  await expect(page.getByText(MEMBER_B)).toBeVisible();
  expect(await marker()).toBe('kept');
  expect(navigations, 'no document navigation for a selection').toEqual([]);
  expect(serverComponentRequests, 'no server-component request for a selection').toEqual([]);

  await page.evaluate(() => window.history.back());
  await expect.poll(() => new URL(page.url()).searchParams.has('poll')).toBe(false);
  await expect(cardBody(page, 'E2E Ana')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(MEMBER_A)).toBeVisible();
  expect(await marker()).toBe('kept');
});

test('S3: the Switch poll chips swap in place without scrolling and keep focus', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px selection proof is phone-only');
  await mockPolls(page);
  await openPlanning(page);

  const chips = switchPoll(page);
  await expect(chips.getByRole('button')).toHaveCount(2);
  const chipA = chips.getByRole('button', { name: "E2E Ana's check-in", exact: true });
  const chipB = chips.getByRole('button', { name: "E2E Ben's check-in", exact: true });
  await expectTouchTarget(chipA, "E2E Ana's chip", { axes: 'height' });
  await expectTouchTarget(chipB, "E2E Ben's chip", { axes: 'height' });

  await chipB.tap();
  await expect(page.getByText(MEMBER_B)).toBeVisible();
  await expect(chipB).toHaveAttribute('aria-pressed', 'true');

  const before = await page.evaluate(() => window.scrollY);
  await chipA.tap();
  await expect(page.getByText(MEMBER_A)).toBeVisible();
  await expect(chipA).toHaveAttribute('aria-pressed', 'true');
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before), `a chip swap scrolled the page (${before}px to ${after}px)`).toBeLessThanOrEqual(2);
  await expect(chipA).toBeFocused();
});

test('S4: opening a card kebab selects nothing', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px selection proof is phone-only');
  await mockPolls(page);
  await openPlanning(page);
  await expect(cardBody(page, 'E2E Ana')).toHaveAttribute('aria-pressed', 'true');
  const urlBefore = page.url();

  const trigger = cardRow(page, 'E2E Ben').getByRole('button', { name: 'Check-in actions', exact: true });
  await trigger.tap();
  const end = page.getByRole('button', { name: 'End check-in' });
  await expect(end).toBeVisible();
  await expect(cardBody(page, 'E2E Ana')).toHaveAttribute('aria-pressed', 'true');
  await expect(cardBody(page, 'E2E Ben')).toHaveAttribute('aria-pressed', 'false');
  expect(page.url()).toBe(urlBefore);

  // The kebab binds Escape on its container (src/components/ui/useDismissal.ts ("the container Escape handler")),
  // so the key is pressed with focus on the trigger, not wherever a tap left it.
  await trigger.press('Escape');
  await expect(end).toHaveCount(0);
});

test('S5: a shared link opens its poll; an unknown poll id falls back to the active poll with no error', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px selection proof is phone-only');
  await mockPolls(page);

  await openPlanning(page, `&poll=${POLL_B_ID}`);
  await expect(cardBody(page, 'E2E Ben')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(MEMBER_B)).toBeVisible();

  await openPlanning(page, `&poll=${UNKNOWN_POLL_ID}`);
  await expect(page.getByText(MEMBER_A)).toBeVisible();
  await expect(cardBody(page, 'E2E Ana')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => new URL(page.url()).searchParams.has('poll')).toBe(false);
  expect(new URL(page.url()).searchParams.get('group_id')).toBe(E2E_GROUP_ID);
  await expect(page.getByText("We couldn't load the poll responses")).toHaveCount(0);

  // F16: a malformed poll id is dropped before the person taps, so back after a tap returns to
  // the active poll's entry, with no poll parameter (the drop is a replace, never a new entry).
  await openPlanning(page, '&poll=not-a-uuid');
  await expect.poll(() => new URL(page.url()).searchParams.has('poll')).toBe(false);
  await expect(cardBody(page, 'E2E Ana')).toHaveAttribute('aria-pressed', 'true');
  await cardBody(page, 'E2E Ben').tap();
  await expect.poll(() => new URL(page.url()).searchParams.get('poll')).toBe(POLL_B_ID);
  await expect(page.getByText(MEMBER_B)).toBeVisible();
  await page.evaluate(() => window.history.back());
  await expect.poll(() => new URL(page.url()).searchParams.has('poll')).toBe(false);
  await expect(cardBody(page, 'E2E Ana')).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.get('group_id')).toBe(E2E_GROUP_ID);

  // F14: a 50-character unbroken starter name, selected, stays inside the 375px page.
  routeState.withLongName = true;
  await openPlanning(page);
  await cardBody(page, LONG_STARTER).tap();
  await expect(showingLine(page)).toHaveText(`Showing ${LONG_STARTER}'s check-in`);
  await expectNoHorizontalOverflow(page);
});
