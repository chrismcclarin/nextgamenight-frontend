// Phase 88.6.1-37 (Req 15 V-1b; Req 4 / D-35; D-22; review r2 #198) — the member-name "+" and its
// popover at 375px in a real browser (the `phone` project).
//
// What this proves:
//   A. a double tap on a not-yet-friend's "+" sends ONE request while the "+" is aria-disabled; the
//      failure (an aborted request, the airplane-mode shape) shows copy row X3 as an alert that
//      takes focus where the "+" was, the "+" is back beside it, nothing claims Pending, the line
//      fits the phone, and a retry sends exactly one more request;
//   B. the popover's success region is 1px (sr-only) while empty and visible after Add friend;
//   C. the popover's X3 alert fits the phone;
//   D. (diagnostic) the popover inside the Manage Members dialog: is Add friend exposed, focusable
//      and tappable, and does Escape close only the popover? Measured, not assumed; the verdict
//      goes in the 88.6.1-37 SUMMARY with the CI run URL.
//
// It runs in CI only: the phone project needs the `.auth` storage state, which does not exist
// locally. The RED halves of A-C are the jsdom pins in ClickableMemberName.indicator.test.tsx.
//
// No request reaches the backend: every friend-request POST is aborted or fulfilled in the
// browser, because the seeded not-yet-friend rows (e2e-fixtures.js) are shared with
// touch-targets.spec.ts R4 and D-13 in the same database (fullyParallel is off).
//
// Since Phase 88.6.1-66 the "+" exists only after the self identity AND the first friendship load
// land, so every step that needs it waits with an auto-waiting assertion and none samples the
// first paint.
import { test, expect, type Page, type Locator } from '@playwright/test';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

// Copy row X3 (D-30), byte-equal, straight apostrophe (D-32 R8).
const X3 = "We couldn't send that request.";
const FRIEND_REQUEST_ROUTE = '**/api/friendships/request';
const VIEWPORT_WIDTH = 375;

// Registers the friend-request intercept. Call it BEFORE page.goto. A POST is counted, held until
// `hold` settles when one is given, then aborted (no network) or fulfilled in the browser; any
// other method falls back. Returns a getter for the POST count.
async function routeFriendRequest(
  page: Page,
  mode: 'abort' | 'succeed',
  hold?: Promise<void>,
): Promise<() => number> {
  let posts = 0;
  await page.route(FRIEND_REQUEST_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    posts += 1;
    if (hold) await hold;
    if (mode === 'abort') {
      await route.abort('internetdisconnected');
    } else {
      await route.fulfill({
        status: 201,
        json: { id: '00000000-0000-4000-8000-000000000037', status: 'pending' },
      });
    }
  });
  return () => posts;
}

// The first not-yet-friend "+" in `scope`, waited for (it appears only after the first friendship
// load), scrolled into view, and re-located by its exact accessible name so later steps keep
// pointing at the same member.
async function findPlus(scope: Page | Locator): Promise<{ plus: Locator; label: string }> {
  const first = scope.getByRole('button', { name: /^add .+ as a friend$/i }).first();
  await expect(
    first,
    'no add-friend "+" became visible — e2e-fixtures.js seeds a not-yet-friend member for this surface, and since Phase 88.6.1-66 the "+" appears only after the first friendship load; a missing "+" is a fixture or locator failure, not the behaviour under test',
  ).toBeVisible({ timeout: 15_000 });
  await first.scrollIntoViewIfNeeded();
  const label = (await first.getAttribute('aria-label')) ?? '';
  expect(label, 'the "+" has no aria-label').not.toBe('');
  return { plus: scope.getByRole('button', { name: label, exact: true }), label };
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function openPopoverFromName(plus: Locator): Promise<void> {
  const name = plus.locator('xpath=preceding-sibling::*[1]');
  await expect(name, 'the "+"\'s previous sibling is the member name trigger').toHaveAttribute('role', 'button');
  await name.tap();
}

test.describe('member "+" and popover at 375 (Phase 88.6.1-37, V-1b)', () => {
  test.skip(({ isMobile }) => !isMobile, 'V-1b is a phone check — phone project only');

  test('V-1b: a double tap on + at 375 sends one request; the failure shows X3 where the + was, keeps focus on it, offers the + again, and fits the phone', async ({
    page,
  }) => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts = await routeFriendRequest(page, 'abort', hold);
    await page.goto(E2E_EVENT_DETAIL_PATH);
    const { plus, label } = await findPlus(page);

    await plus.tap();
    // The second tap is forced: a held "+" is aria-disabled, which Playwright's actionability
    // check would wait out; a person's thumb does not.
    await plus.tap({ force: true });
    await expect(plus, 'the pressed "+" carries aria-disabled while its send is held').toHaveAttribute('aria-disabled', 'true');
    await expect(plus, 'the pressed "+" is never natively disabled (it stays in the focus order)').not.toHaveAttribute('disabled');
    await expect(plus, 'the pressed "+" stays visible while held').toBeVisible();
    expect(posts(), 'a double tap inside one flight sends exactly one friend-request POST').toBe(1);

    release();
    const alert = page.getByRole('alert').filter({ hasText: X3 });
    await expect(alert, 'the failure shows copy row X3 as an alert').toBeVisible();
    await expect(alert, 'the alert reads X3 exactly').toHaveText(X3);
    await expect(alert, 'focus lands on the failure line where the "+" was').toBeFocused();
    await expect(plus, 'the "+" is no longer aria-disabled once the send settled').not.toHaveAttribute('aria-disabled', 'true');

    const sibling = await alert.evaluate((el) => {
      const next = el.nextElementSibling;
      return next ? { tag: next.tagName, label: next.getAttribute('aria-label') } : null;
    });
    expect(sibling, `the alert's next sibling is the "+" with the same name (got ${JSON.stringify(sibling)})`).toEqual({
      tag: 'BUTTON',
      label,
    });

    const row = alert.locator('xpath=..');
    await expect(row.getByText('⏳ Pending'), 'no Pending claim beside a failed send').toHaveCount(0);
    expect(posts(), 'an aborted send pulls no further friend-request POST').toBe(1);

    const box = await alert.boundingBox();
    expect(box, 'the alert has a layout box').not.toBeNull();
    expect(box!.x, `the alert starts inside the viewport (x=${box!.x})`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `the alert ends inside 375px (right=${box!.x + box!.width})`).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(await noHorizontalOverflow(page), 'the failure line causes no horizontal page scroll').toBe(true);

    await plus.tap();
    await expect.poll(posts, { message: 'a retry tap sends exactly one more POST' }).toBe(2);
    await expect(alert, 'the retry fails again and the alert is back').toBeVisible();
    await expect(alert, 'focus is on the failure line again after the retry').toBeFocused();

    await page.unroute(FRIEND_REQUEST_ROUTE);
  });

  test("the popover's success line at 375: hidden while empty, visible after", async ({ page }) => {
    const posts = await routeFriendRequest(page, 'succeed');
    await page.goto(E2E_EVENT_DETAIL_PATH);
    const { plus } = await findPlus(page);
    await openPopoverFromName(plus);

    const addFriend = page.getByRole('button', { name: 'Add friend', exact: true });
    await expect(addFriend, 'the popover opened from the name tap and offers Add friend').toBeVisible();

    const region = page.locator('[data-floating-ui-portal] [role="status"]');
    await expect(region, 'the popover holds exactly one status region').toHaveCount(1);
    await expect(region, 'the success region is empty before Add friend').toHaveText('');
    const empty = await region.boundingBox();
    expect(empty, 'the empty region still has a (1px) box').not.toBeNull();
    expect(
      empty!.width <= 1 && empty!.height <= 1,
      `the empty region is sr-only, 1x1 at most (got ${empty!.width}x${empty!.height})`,
    ).toBe(true);

    await addFriend.tap();
    // Read at once: the popover closes 1.5s after a success, and plan 66's follow-up load then
    // reads the real server lists (which never saw this fulfilled POST), so nothing here reads the
    // inline indicator.
    await expect(region, 'the same region now says Request sent').toContainText('Request sent');
    const shown = await region.boundingBox();
    expect(shown, 'the filled region has a layout box').not.toBeNull();
    expect(shown!.height, `the filled region is visible (height ${shown!.height})`).toBeGreaterThan(1);
    expect(shown!.x + shown!.width, `the filled region ends inside 375px`).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(posts(), 'one Add friend tap sends one POST').toBe(1);

    await page.unroute(FRIEND_REQUEST_ROUTE);
  });

  test("the popover's failure line at 375", async ({ page }) => {
    const posts = await routeFriendRequest(page, 'abort');
    await page.goto(E2E_EVENT_DETAIL_PATH);
    const { plus } = await findPlus(page);
    await openPopoverFromName(plus);
    const addFriend = page.getByRole('button', { name: 'Add friend', exact: true });
    await expect(addFriend, 'the popover opened and offers Add friend').toBeVisible();
    await addFriend.tap();

    const alert = page.locator('[data-floating-ui-portal]').getByRole('alert');
    await expect(alert, 'the popover failure reads copy row X3').toHaveText(X3);
    const box = await alert.boundingBox();
    expect(box, 'the popover alert has a layout box').not.toBeNull();
    expect(box!.x, 'the popover alert starts inside the viewport').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'the popover alert ends inside 375px').toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(await noHorizontalOverflow(page), 'the popover failure causes no horizontal page scroll').toBe(true);
    expect(posts(), 'one Add friend tap sends one POST').toBe(1);

    await page.unroute(FRIEND_REQUEST_ROUTE);
  });

  test('D (diagnostic): the member popover inside the Manage Members dialog at 375 — Add friend is visible, exposed, focusable and tappable, and Escape closes only the popover', async ({
    page,
  }) => {
    const posts = await routeFriendRequest(page, 'succeed');
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);

    const manageMembers = page.getByRole('button', { name: /manage members/i });
    await expect(
      manageMembers,
      'the "Manage Members" CTA did not render — the fixture user OWNS the seeded group, so this is a fixture or locator failure',
    ).toBeVisible({ timeout: 15_000 });
    await manageMembers.tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog, 'the Manage Members dialog opened').toBeVisible();

    const { plus } = await findPlus(dialog);
    await openPopoverFromName(plus);

    // Located WITHOUT the accessibility tree, so the locator cannot hide the defect it measures.
    const addFriend = page.locator('[data-floating-ui-portal] button', { hasText: 'Add friend' });
    await expect(
      addFriend,
      'the popover did not open with Add friend inside the dialog — nothing below means anything; a locator or fixture failure',
    ).toBeVisible();

    const m = await addFriend.evaluate((btn) => {
      const describe = (el: Element | null): string | null =>
        el
          ? `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}.${(el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')}`
          : null;
      const hidden = btn.closest('[aria-hidden="true"], [inert]');
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      (btn as HTMLElement).focus();
      return {
        inDialog: btn.closest('[role="dialog"]') !== null,
        hiddenAncestor: hidden
          ? `${describe(hidden)} aria-hidden=${hidden.getAttribute('aria-hidden')} inert=${hidden.hasAttribute('inert')}`
          : null,
        pointerEvents: getComputedStyle(btn).pointerEvents,
        hitTarget: describe(hit),
        hitInside: hit !== null && btn.contains(hit),
        focused: document.activeElement === btn,
        activeAfterFocus: describe(document.activeElement),
        x: r.x,
        right: r.right,
      };
    });

    // Chrome's own accessibility tree for the button (the phone project is chromium).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression:
        "Array.from(document.querySelectorAll('[data-floating-ui-portal] button')).find((b) => b.textContent.trim() === 'Add friend')",
    });
    const objectId = evaluated.result.objectId;
    expect(objectId, 'CDP resolved the Add friend button to a remote object (a spec defect if not)').toBeTruthy();
    const ax = await cdp.send('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false });
    const node = ax.nodes[0];
    const ignoredReasons = (node?.ignoredReasons ?? []).map((reason) => reason.name);
    const measured = `measured: ${JSON.stringify({ ...m, axIgnored: node?.ignored, ignoredReasons })}`;

    expect.soft(m.hiddenAncestor, `(i) Add friend has no aria-hidden / inert ancestor — ${measured}`).toBeNull();
    expect.soft(node?.ignored, `(ii) Add friend is in Chrome's accessibility tree (not ignored) — ${measured}`).toBe(false);
    expect.soft(m.focused, `(iii) Add friend took focus — ${measured}`).toBe(true);
    expect
      .soft(m.hitInside && m.pointerEvents !== 'none', `(iv) Add friend is the hit target at its centre and takes pointer events — ${measured}`)
      .toBe(true);
    expect
      .soft(m.x >= 0 && m.right <= VIEWPORT_WIDTH, `(v) Add friend lies inside the 375px viewport — ${measured}`)
      .toBe(true);

    if (m.hitInside && m.pointerEvents !== 'none') {
      await addFriend.tap();
      await expect.poll(posts, { message: 'the tap on Add friend inside the dialog sent one POST' }).toBe(1);
      await expect
        .soft(page.locator('[data-floating-ui-portal] [role="status"]'), 'Request sent shows after the in-dialog tap')
        .toContainText('Request sent');
    }
    // When (iv) failed the tap is NOT made: a tap that falls through could press another member's
    // control (Approve, Reject, the role menu) in the shared fixture group.

    // (vi) Escape, measured LAST so a dialog that wrongly closes cannot void (i)-(v).
    const popover = page.locator('[data-floating-ui-portal] [data-member-popover]');
    if (!(await popover.isVisible())) {
      await expect(popover, 'the popover closed after the tap (its 1.5s success close)').toBeHidden({ timeout: 5_000 });
      await openPopoverFromName(plus);
      await expect(popover, 'the popover re-opened from the name').toBeVisible();
    }
    const heldFocus = await popover.evaluate((root) => {
      const target = root.querySelector('button') ?? root;
      (target as HTMLElement).focus();
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()} "${(a.textContent ?? '').trim().slice(0, 40)}" inside-popover=${root.contains(a)}` : 'none';
    });
    await page.keyboard.press('Escape');
    const popoverGone = await popover
      .waitFor({ state: 'hidden', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    const dialogOpen = await dialog.isVisible();
    expect
      .soft(
        popoverGone && dialogOpen,
        `(vi) Escape from inside the popover closes the popover and leaves the dialog open — focus at the press: ${heldFocus}; popover closed: ${popoverGone}; dialog still open: ${dialogOpen}`,
      )
      .toBe(true);

    await page.unroute(FRIEND_REQUEST_ROUTE);
  });
});
