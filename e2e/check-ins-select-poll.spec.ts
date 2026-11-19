import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';
import { scrubbedFetch } from './support/scrubbedFetch';
import { expectTouchTarget } from './support/touchTarget';
import { expectHeldInside, expectNeighbourWhole, expectWholeWords, readWordLines, setNarrowLargeText, TWO_WORD_NAME } from './support/wordLines';

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
  await expect(page.getByText("Couldn't load the poll responses")).toHaveCount(0);

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

// 88.9-52 R4 D2 (owner 2026-11-18: wrap, no line limit, and the name keeps its room; his worry: a
// long name broken up too much to read, We/eke/nd W/arr/iors). A check-in card cut its title (the
// poll's game name) to one line beside the kebab; it now wraps by whole words and the kebab drops
// under it (src/app/components/OpenPollsList.js ("AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the title wraps")).
// Both synthetic polls are given one game, and the real group read is passed through with that
// game added to its list, so both cards are titled with the two-word name (nothing is written).
// At 375 with ordinary text the kebab still shares the title's line. At 320 wide with the root text
// at 200% each word of the title is on one line (or, for a word wider than the whole card, broken
// only after the title has the card's full width), the kebab is whole, at least 44px and inside
// the card. The same test reads the Switch poll chips, the page's second cut
// (src/app/groupPlanning/page.js ("AMENDED Phase 88.9-52 (R4 D2, the second cut on this page")):
// both polls share the game's name, so each chip's label is that name plus the label rule's own
// suffix, and every word of it must be whole inside a chip that is whole inside the row, at least
// 44px. The page's own sideways scroll at this size is recorded in the log: the rest of the
// planning page at 320 / 200% is not this test's subject.
const D2_GAME_ID = '26102600-0000-4000-8000-0000000000d2';

test('R4 D2 (88.9-52): at 320 wide with 200% text a check-in card and a Switch poll chip keep each word of a two-word name whole; the kebab drops under the card body', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 320px large-text proof is phone-only');
  await mockPolls(page);
  // Registered after mockPolls, so these two answer first.
  await page.route('**/api/groups/*/prompts/open', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    routeState.openGets += 1;
    await route.fulfill({
      status: 200,
      json: { prompts: [{ ...POLLS[POLL_A_ID], game_id: D2_GAME_ID }, { ...POLLS[POLL_B_ID], game_id: D2_GAME_ID }] },
    });
  });
  await page.route(
    (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}`),
    async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const response = await scrubbedFetch(route);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const group = body as { games?: unknown };
        const games = Array.isArray(group.games) ? group.games : [];
        group.games = [...games, { id: D2_GAME_ID, name: TWO_WORD_NAME }];
      }
      await route.fulfill({ response, json: body });
    },
  );
  await openPlanning(page);

  const rows = [cardRow(page, 'E2E Ana'), cardRow(page, 'E2E Ben')];
  const titleOf = (row: Locator) => row.locator('span.font-bold', { hasText: TWO_WORD_NAME });
  const kebabOf = (row: Locator) => row.getByRole('button', { name: 'Check-in actions', exact: true });
  for (const row of rows) {
    await expect(titleOf(row), 'R4 D2: a card is not titled with the answered game name (the group read did not take the added game)').toHaveCount(1, { timeout: 15_000 });
  }

  // Ordinary text at 375: the kebab is beside the body, as before.
  for (const [i, row] of rows.entries()) {
    const beside = await row.evaluate((el) => {
      const body = el.firstElementChild as HTMLElement;
      const cell = el.lastElementChild as HTMLElement;
      const b = body.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      return { bodyRight: b.right, bodyBottom: b.bottom, cellLeft: c.left, cellTop: c.top };
    });
    expect(
      beside.cellTop < beside.bodyBottom - 1 && beside.cellLeft >= beside.bodyRight - 1,
      `R4 D2 card ${i}: at ordinary text the kebab no longer sits beside the card body (${JSON.stringify(beside)})`,
    ).toBe(true);
    expectWholeWords(await readWordLines(titleOf(row), row), ['Weekend', 'Warriors'], `R4 D2 card ${i} at ordinary text`, { pageSideways: false });
  }

  await setNarrowLargeText(page, 'R4 D2 check-in card');
  for (const [i, row] of rows.entries()) {
    // The card is named as the row: a word may break only once the title has the card's whole width.
    const read = await readWordLines(titleOf(row), row);
    // eslint-disable-next-line no-console -- the measured card is recorded from the CI log
    console.log(`[88.9-52 R4 D2 check-in card ${i}] 320 / 200%: ${JSON.stringify(read)}`);
    expectWholeWords(read, ['Weekend', 'Warriors'], `R4 D2 card ${i} at 320 / 200%`, { pageSideways: false });
    await expectHeldInside(row, `R4 D2 card ${i}`);
    await expectNeighbourWhole(kebabOf(row), `R4 D2 card ${i}: the kebab`, { button: true });
  }

  // The Switch poll chips: each label holds the answered name, uncut, and each chip is whole.
  const chipRow = switchPoll(page);
  const chips = chipRow.getByRole('button');
  await expect(chips, 'R4 D2: the Switch poll row does not hold the two chips').toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    const chip = chips.nth(i);
    const label = chip.locator(':scope > span');
    // The chip row is named: a word may break only once the label has the row's whole width.
    const read = await readWordLines(label, chipRow);
    // eslint-disable-next-line no-console -- the measured chip is recorded from the CI log
    console.log(`[88.9-52 R4 D2 switch-poll chip ${i}] 320 / 200%: ${JSON.stringify(read)}`);
    expect(read.text, `R4 D2 chip ${i}: the label does not hold the answered name (${JSON.stringify(read)})`).toContain(TWO_WORD_NAME);
    expectWholeWords(read, null, `R4 D2 chip ${i} at 320 / 200%`, { pageSideways: false });
    await expectNeighbourWhole(chip, `R4 D2 chip ${i}`, { button: true });
  }
  await expectHeldInside(chipRow, 'R4 D2 Switch poll row');
});
