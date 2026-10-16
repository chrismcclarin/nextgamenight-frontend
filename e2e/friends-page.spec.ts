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
