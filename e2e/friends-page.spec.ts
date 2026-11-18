// Phase 88.6.1-40 (Req 7 / AC-23; Req 4 / D-35; Req 8 / D-22) — the Friends page's tab strip and
// its Invite to Group button in a real browser, in BOTH projects (`phone` at 375 and `journeys`).
//
// What this proves:
//   1. the keyboard-focused Friends tab paints its ring INSIDE the tab (an inset box-shadow with a
//      2px spread and no outset layer), the ring stops at the strip line, the label and its count
//      pill lie inside the ring's inner edge (the box less 2px), the count pill sits in the middle
//      of the tab between the ring's top edge and the active underline, the three tabs fit the
//      strip on one line, and once focus moves on the inset ring is gone.
//      AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred): this used to prove the house OUTSET
//      ring (88.6.1-40 Req 7, a 4px spread outside the box). The marker is at
//      src/app/friends/page.js ("AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred").
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
import { assertTheme, forceLightMode } from './support/contrast';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { describeSamples, paintedTexts, recordLabel, spread, stopLabelRecorder, valuesAt } from './support/labelRecorder';

const INVITE_ROUTE = '**/invites/send';
const RING_SPREAD = '0px 0px 0px 2px inset';
const RING_WIDTH = 2;

function friendsTab(page: Page): Locator {
  // The tab's name is its label plus its count pill, e.g. "Friends" or "Friends 3".
  return page.getByRole('button', { name: /^Friends\s*\d*$/ });
}

async function boxShadow(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).boxShadow);
}

test.describe('friends page tab ring and Invite to Group (Phase 88.6.1-40)', () => {
  test('the keyboard-focused Friends tab paints an inset ring clear of its centred label, gone once blurred', async ({
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
    expect(focused, 'the focused tab paints a 2px inset ring').toContain(RING_SPREAD);
    expect(focused, 'no outset ring is left').not.toContain('0px 0px 0px 4px');

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
      // The strip is the first ancestor that draws a bottom border; its line starts at the bottom
      // of its padding box. The row is the tabs' own parent.
      let lineTop: number | null = null;
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const line = parseFloat(getComputedStyle(up).borderBottomWidth);
        if (line > 0) {
          lineTop = up.getBoundingClientRect().bottom - line;
          break;
        }
      }
      const row = el.parentElement as HTMLElement;
      const tabs = Array.from(row.querySelectorAll(':scope > button')).map((b) => {
        const r = b.getBoundingClientRect();
        return { width: r.width, height: r.height, right: r.right };
      });
      return {
        hasLabel: Boolean(label),
        box: toPlain(box),
        text: toPlain(text),
        pill: pillBox ? toPlain(pillBox) : null,
        underline: parseFloat(getComputedStyle(el).borderBottomWidth) || 0,
        lineTop,
        rowRight: row.getBoundingClientRect().right,
        tabs,
      };
    });
    expect(geometry.hasLabel, 'the tab has a text label').toBe(true);
    const { box, text, pill, underline, lineTop, rowRight, tabs } = geometry;
    // The ring is the 2px band just inside the tab's box (on the active tab its bottom edge sits
    // on top of the underline, which is the tab's own bottom border). The label is clear of it.
    const inner = {
      left: box.left + RING_WIDTH,
      top: box.top + RING_WIDTH,
      right: box.right - RING_WIDTH,
      bottom: box.bottom - underline - RING_WIDTH,
    };
    expect(text.left, `label left ${text.left} vs ring inner edge ${inner.left}`).toBeGreaterThanOrEqual(inner.left);
    expect(text.right, `label right ${text.right} vs ring inner edge ${inner.right}`).toBeLessThanOrEqual(inner.right);
    expect(text.top, `label top ${text.top} vs ring inner edge ${inner.top}`).toBeGreaterThanOrEqual(inner.top);
    expect(text.bottom, `label bottom ${text.bottom} vs ring inner edge ${inner.bottom}`).toBeLessThanOrEqual(inner.bottom);
    // Equal space at the two sides: the word starts as far from the ring as the label ends.
    const labelRight = pill ? pill.right : text.right;
    const sideLeft = text.left - inner.left;
    const sideRight = inner.right - labelRight;
    expect(Math.abs(sideLeft - sideRight), `side space ${sideLeft} left vs ${sideRight} right`).toBeLessThanOrEqual(1.5);
    if (pill) {
      expect(pill.left, `pill left ${pill.left} vs ring inner edge ${inner.left}`).toBeGreaterThanOrEqual(inner.left);
      expect(pill.right, `pill right ${pill.right} vs ring inner edge ${inner.right}`).toBeLessThanOrEqual(inner.right);
      expect(pill.top, `pill top ${pill.top} vs ring inner edge ${inner.top}`).toBeGreaterThanOrEqual(inner.top);
      expect(pill.bottom, `pill bottom ${pill.bottom} vs ring inner edge ${inner.bottom}`).toBeLessThanOrEqual(inner.bottom);
      // R11: the same space above the label as below it. The count pill is the tallest painted
      // thing in the label; the picture the owner picked measured 9.5px each way on this tab.
      // AMENDED Phase 88.9-52 (R4 S3): measured to the TAB's own top and bottom edges, as the
      // round-3 capture measured it (10.5 above, 13.5 below on this tab as R11 was built), and
      // held to half a pixel. This tab is the active one: its ring stops at its 2px underline,
      // so inside the ring the pill has 2px less under it than over it; that is the underline,
      // not an off-centre label, and the all-tabs read below holds every tab to its own edges.
      const above = pill.top - box.top;
      const below = box.bottom - pill.bottom;
      expect(Math.abs(above - below), `space above the pill ${above} vs below it ${below}, to the tab's edges`).toBeLessThanOrEqual(0.5);
    }
    // The ring stays inside the tab, and the tab ends on the strip line without crossing it.
    expect(lineTop, 'the strip draws a bottom line').not.toBeNull();
    expect(box.bottom - (lineTop as number), `the tab ends ${box.bottom - (lineTop as number)}px past the strip line`).toBeLessThanOrEqual(0.5);
    // Three tabs, each at least 44 x 44, all on one line inside the strip.
    expect(tabs.length, 'the strip holds three tabs').toBe(3);
    for (const t of tabs) {
      expect(t.width, `a tab is ${t.width}px wide`).toBeGreaterThanOrEqual(44);
      expect(t.height, `a tab is ${t.height}px tall`).toBeGreaterThanOrEqual(44);
      expect(t.height, `a tab is ${t.height}px tall, so its label wrapped`).toBeLessThanOrEqual(45);
    }
    expect(tabs[2].right, `the last tab ends at ${tabs[2].right}, the strip at ${rowRight}`).toBeLessThanOrEqual(rowRight + 0.5);

    // Positive control: focus moves on, and the Friends tab no longer paints the ring.
    await page.keyboard.press('Tab');
    await expect(tab).not.toBeFocused();
    expect(await boxShadow(tab), 'no inset ring once blurred').not.toContain(RING_SPREAD);

    // R4 S3 (88.9-52), RENDERED. The round-3 capture found two things in the strip R11 built:
    // the label was not in the middle of its tab (11.5 / 12.5 on Requests, 10.5 / 13.5 on Friends,
    // 11.5 / 14.5 on Sent), and at 200% text the tabs (549px) overran the strip (311px), the page
    // scrolled sideways (581px on a 375px screen) and Sent was off screen. Now every tab centres
    // its word and pill, and the strip scrolls inside itself
    // (src/app/friends/page.js ("DECISION Phase 88.9-52 (R4 S3, the round-3 capture: at 200% text the three")).
    // Read-only: pressing a tab writes nothing.
    const readStrip = () =>
      page.evaluate(() => {
        const first = Array.from(document.querySelectorAll('button')).find((b) => /^Friends\s*\d*$/.test((b.textContent ?? '').trim())) as HTMLElement;
        const row = first.parentElement as HTMLElement;
        const r = row.getBoundingClientRect();
        const doc = document.documentElement;
        const tabs = (Array.from(row.querySelectorAll(':scope > button')) as HTMLElement[]).map((b) => {
          const box = b.getBoundingClientRect();
          const word = Array.from(b.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
          const range = document.createRange();
          if (word) range.selectNodeContents(word);
          const w = range.getBoundingClientRect();
          const pill = b.querySelector('span');
          const p = pill ? pill.getBoundingClientRect() : null;
          const top = Math.min(w.top, p ? p.top : w.top);
          const bottom = Math.max(w.bottom, p ? p.bottom : w.bottom);
          return {
            label: (word?.textContent ?? '').trim(),
            current: b.getAttribute('aria-current') === 'true',
            left: box.left,
            right: box.right,
            height: box.height,
            above: top - box.top,
            below: box.bottom - bottom,
            sideLeft: w.left - box.left,
            sideRight: box.right - (p ? p.right : w.right),
            wordLines: Math.round(w.height / parseFloat(getComputedStyle(b).lineHeight)),
          };
        });
        // What reaches past the right edge of the window, for the failure message only (tag and width, no text).
        const wide = (Array.from(document.querySelectorAll('body *')) as HTMLElement[])
          .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1 && !row.contains(el))
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()} to ${Math.round(el.getBoundingClientRect().right)}px`);
        return {
          rootFontPx: parseFloat(getComputedStyle(doc).fontSize),
          window: doc.clientWidth,
          pageSideways: doc.scrollWidth - doc.clientWidth,
          wide,
          row: { left: r.left, right: r.right, scrolls: row.scrollWidth - row.clientWidth, upDown: row.scrollHeight - row.clientHeight },
          tabs,
        };
      });
    const pressTab = (label: string) =>
      // A DOM click: Playwright's own click would scroll the tab into view first and hide whether the page does.
      page.evaluate((name) => {
        const b = Array.from(document.querySelectorAll('button')).find((el) => new RegExp('^' + name + '\\s*\\d*$').test((el.textContent ?? '').trim())) as HTMLElement;
        b.click();
      }, label);
    const checkCentred = (where: string, strip: Awaited<ReturnType<typeof readStrip>>) => {
      expect(strip.tabs.map((t) => t.label), `${where}: the three tabs`).toEqual(['Friends', 'Requests', 'Sent']);
      for (const t of strip.tabs) {
        expect(Math.abs(t.above - t.below), `${where}: ${t.label} has ${t.above}px above its label and ${t.below}px below`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(t.sideLeft - t.sideRight), `${where}: ${t.label} has ${t.sideLeft}px left of its label and ${t.sideRight}px right`).toBeLessThanOrEqual(0.5);
        expect(t.wordLines, `${where}: the ${t.label} label is on ${t.wordLines} lines`).toBe(1);
      }
      // Every label on one line across the strip: the word does not jump when a tab is chosen.
      expect(strip.row.upDown, `${where}: the strip scrolls up and down by ${strip.row.upDown}px`).toBeLessThanOrEqual(0);
    };

    const rest = await readStrip();
    expect(rest.rootFontPx, 'R4 S3: text is not at its ordinary size before the 200% step').toBe(16);
    checkCentred('ordinary text', rest);
    expect(rest.row.scrolls, `R4 S3: at ordinary text the strip scrolls sideways by ${rest.row.scrolls}px — the three tabs should fit`).toBeLessThanOrEqual(0);

    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
        message: 'R4 S3: the root font size did not become 32px after the 200% style tag',
      })
      .toBe('32px');
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 740 });
      await expect.poll(async () => (await readStrip()).window, { message: `R4 S3: the window did not become ${width}px wide` }).toBe(width);
      const where = `200% text, ${width} wide`;
      const big = await readStrip();
      expect(big.pageSideways, `R4 S3 (${where}): the page scrolls sideways by ${big.pageSideways}px (${big.wide.join('; ')})`).toBeLessThanOrEqual(1);
      expect(big.row.right, `R4 S3 (${where}): the strip runs past the right edge of the window`).toBeLessThanOrEqual(width + 0.5);
      expect(big.row.scrolls, `R4 S3 (${where}): the strip does not scroll, so a tab past its edge could not be reached`).toBeGreaterThan(0);
      checkCentred(where, big);
      // Each tab in turn: pressed, it is the current tab and lies wholly inside the strip.
      for (const label of ['Sent', 'Requests', 'Friends']) {
        await pressTab(label);
        await expect
          .poll(
            async () => {
              const now = await readStrip();
              const t = now.tabs.find((x) => x.label === label);
              return Boolean(t && t.current && t.left >= now.row.left - 0.5 && t.right <= now.row.right + 0.5);
            },
            { message: `R4 S3 (${where}): the pressed ${label} tab is not current and wholly inside the strip` },
          )
          .toBe(true);
        checkCentred(`${where}, ${label} chosen`, await readStrip());
      }
    }
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

  // Plan 88.9-58 (owner 2026-11-14, on the live page: "Why not just turn them into white cards?").
  // The friend row and the request row paint the card colour, read against the Add Friend card on
  // the same page, in both themes and at both widths; with a fine pointer (journeys) the row is
  // also hovered on its own padding and must not change. The row is found by its data attribute
  // and the card by walking up from the email field, so no colour literal is pinned here: the two
  // surfaces must simply agree. Both lists are answered in the browser; nothing is written.
  test('X14 Friends rows (88.9): friend and request rows paint the card colour in both themes and do not react to hover', async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const friend = { id: 'e2e-friends-x14-f', friend: { id: '8861a072-0000-4000-8000-0000000000b1', username: 'E2E Card Friend' } };
    const request = { id: 'e2e-friends-x14-r', Requester: { id: '8861a072-0000-4000-8000-0000000000b2', username: 'E2E Card Requester' } };
    await page.route(
      (url) => isFriendshipList(url, 'status', 'accepted'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 200, json: [friend] });
      },
    );
    await routeReceived(page, () => ({ status: 200, json: [request] }));

    const background = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
    const readRow = async (row: Locator, card: string, what: string) => {
      await expect(row, `${what}: the row never rendered`).toBeVisible({ timeout: 15_000 });
      await page.mouse.move(0, 0);
      const rest = await background(row);
      expect(rest, `${what}: the row paints ${rest}, the Add Friend card paints ${card}`).toBe(card);
      if (project === 'journeys') {
        // A point on the row's own 16px left padding where the row itself is the topmost element
        // (never under the sticky header, never over a control).
        const point = await row.evaluate((el) => {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const box = el.getBoundingClientRect();
          const x = box.left + 6;
          for (let y = Math.max(box.top + 6, 0); y <= Math.min(box.bottom - 6, window.innerHeight - 1); y += 4) {
            if (document.elementFromPoint(x, y) === el) return { x, y };
          }
          return null;
        });
        expect(point, `${what}: no point on the row's left padding is uncovered, so it cannot be hovered`).not.toBeNull();
        await page.mouse.move(point!.x, point!.y);
        expect(await row.evaluate((el) => el.matches(':hover')), `${what}: the row never took the hover`).toBe(true);
        // Longer than the house 150ms colour transition, so a wash would have landed.
        await page.waitForTimeout(400);
        const hovered = await background(row);
        expect(hovered, `${what}: the row went from ${rest} to ${hovered} under the mouse`).toBe(rest);
        await page.mouse.move(0, 0);
      }
    };

    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light') await forceLightMode(page);
      await page.goto('/friends');
      await assertTheme(page, theme);
      const email = page.getByLabel("Friend's email address");
      await expect(email, `X14 (${theme}): the Add Friend card never rendered`).toBeVisible({ timeout: 15_000 });
      const addFriendCard = email.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " card ")][1]');
      await expect(addFriendCard, `X14 (${theme}): the email field does not sit on exactly one card`).toHaveCount(1);
      const card = await background(addFriendCard);
      expect(card, `X14 (${theme}): the Add Friend card reads ${card}, which is no fill to compare with`).not.toBe('rgba(0, 0, 0, 0)');

      await readRow(page.locator(`[data-friend-row="${friend.id}"]`), card, `X14 (${theme}, ${project}) friend row`);
      await requestsTab(page).click();
      await readRow(page.locator(`[data-request-row="${request.id}"]`), card, `X14 (${theme}, ${project}) request row`);
    }
  });

  // Plan 88.9-67 (52-X69 widened, owner 2026-11-14: a waiting confirm says Wait, so a person can
  // see that pressing is not an option yet). An armed friend Remove is recorded in the browser
  // from the tap to the live label: what it paints, what it is named, and how wide it is. The
  // width must not change between Wait (3) and the live label (unreserved, the live label was
  // about 84px wider than Wait (1) and shoved the row). R13 (88.9-52, owner 2026-11-17): the live
  // label a person sees is Tap again; the full sentence stays as the control's name. One tap only: nothing is removed, and the
  // describe's write hold fails the test if any write is sent. Both lists are answered in the
  // browser.
  test('X69 (88.9): an armed friend Remove reads Wait (3), (2), (1) then Tap again at one width from the arm, named Tap again to confirm once live and named Remove E2E Friend, wait N seconds while it waits', async ({ page }, testInfo) => {
    const friend = { id: 'e2e-friends-x69-f', friend: { id: '8861a072-0000-4000-8000-0000000000c1', username: 'E2E Friend' } };
    await page.route(
      (url) => isFriendshipList(url, 'status', 'accepted'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 200, json: [friend] });
      },
    );
    await routeReceived(page, () => ({ status: 200, json: [] }));
    await page.goto('/friends');

    const row = page.locator(`[data-friend-row="${friend.id}"]`);
    const remove = row.getByRole('button', { name: 'Remove E2E Friend', exact: true });
    await expect(remove, 'X69: the routed friend row never rendered its Remove').toBeVisible({ timeout: 15_000 });
    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    await remove.scrollIntoViewIfNeeded();
    await recordLabel(remove);
    await remove.click();
    // The live label, after the 3 s gate. Its name is the full sentence, which starts with the
    // visible words (Label in Name).
    await expect(row.getByRole('button', { name: 'Tap again to confirm', exact: true })).toBeVisible({ timeout: 10_000 });
    const samples = await stopLabelRecorder(page);

    const WAITING = ['Wait (3)', 'Wait (2)', 'Wait (1)'];
    const FROM_THE_ARM = [...WAITING, 'Tap again'];
    const trace = describeSamples(samples);
    // eslint-disable-next-line no-console -- the measured widths are recorded from the CI log (plan 88.9-67)
    console.log(`[88.9-67 X69 friend Remove] ${testInfo.project.name}: ${trace}`);
    expect(paintedTexts(samples), `X69: the label did not run Remove, Wait (3), (2), (1), Tap again (${trace})`).toEqual([
      'Remove',
      ...FROM_THE_ARM,
    ]);
    expect(valuesAt(samples, 'Wait (3)', 'name')).toEqual(['Remove E2E Friend, wait 3 seconds']);
    expect(valuesAt(samples, 'Wait (2)', 'name')).toEqual(['Remove E2E Friend, wait 2 seconds']);
    expect(valuesAt(samples, 'Wait (1)', 'name')).toEqual(['Remove E2E Friend, wait 1 second']);
    expect(valuesAt(samples, 'Tap again', 'name')).toEqual(['Tap again to confirm']);
    const jump = spread(samples, FROM_THE_ARM, 'width');
    expect(jump, `X69: the armed Remove changed width by ${jump}px between Wait (3) and its live label (${trace})`).toBeLessThanOrEqual(0.5);
    await expectNoSidewaysScroll(page);
  });
});
