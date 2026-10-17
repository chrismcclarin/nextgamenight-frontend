import { test, expect, type Locator, type Page } from '@playwright/test';
import { holdWrites, holdUntilReleased, type WriteHold } from './support/inFlight';

// Phase 88.6.1-44 (W016, H9, W026; Req 4, 5, 8) — the notification bell's row actions in a real
// browser at 375px (the phone project; the row variant lives in the phone hamburger,
// src/app/Header.js, anchor variant="row" label="Invites").
//
// What this checks that jsdom cannot:
//   - a real browser drops focus from a natively disabled control; the pressed Accept is
//     aria-disabled instead, so it must still be the focused element while its request runs;
//   - real focus after the row leaves (useFocusRecovery acting on a real removal);
//   - the real scheduler order behind arm-on-resolve on a friend request: the provider removes the
//     row only when the server confirms, in a later task than the bell's await continuation;
//   - layout at 375px: the failure and success lines fit the viewport.
// The phone project runs Chromium under the iPhone preset (playwright.config.ts, anchor
// browserName: 'chromium'), so WebKit's tap shape (a tapped button is never focused) is pinned only
// by the unit suite's NA-2 (b).
//
// Runs in CI only (the e2e job on the phase PR). Locally there is no .auth storageState, so this
// file is typechecked (tsconfig.e2e.json) and listed, never run.
//
// Its only interception is the two shared helpers in ./support/inFlight: plan 88.6.1-43's
// holdWrites net (registered first; it answers this test's lists in the browser through answerGet
// and holds every other write unanswered) and holdUntilReleased for the one write under test,
// answered in the browser on release. The spec registers no route of its own, so nothing it does
// reaches the shared CI database.

const INVITE_A = {
  id: 'e2e-bell-invite-a',
  Group: { name: 'E2E Bell Alpha' },
  Inviter: { username: 'E2E Host' },
};
const INVITE_B = {
  id: 'e2e-bell-invite-b',
  Group: { name: 'E2E Bell Beta' },
  Inviter: { username: 'E2E Host' },
};
const REQUEST_A = {
  id: 'e2e-bell-request-a',
  Requester: { id: '0e2eb0e1-0000-4000-8000-00000000000a', username: 'E2E Bell Ana' },
};
const REQUEST_B = {
  id: 'e2e-bell-request-b',
  Requester: { id: '0e2eb0e1-0000-4000-8000-00000000000b', username: 'E2E Bell Ben' },
};

// Copy row N3 (88.6.1-COPY-TABLE.html, U+2019 normalised to a straight apostrophe).
const N3 = "We couldn't accept that invite. Please try again.";

// The lists the bell reads, answered in the browser; every other read goes through untouched.
function answersFor(invites: unknown[], received: () => unknown[]) {
  return (url: URL): unknown => {
    if (url.pathname.endsWith('/invites/pending')) return invites;
    if (url.pathname.endsWith('/friendships') && url.searchParams.get('direction') === 'received') {
      return received();
    }
    return undefined;
  };
}

async function openBellPanel(page: Page): Promise<Locator> {
  const menuButton = page.getByRole('button', { name: 'Toggle menu' });
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Invites notifications', exact: true }).click();
  const region = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(region).toBeVisible();
  return region;
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, 'the phone project must define a viewport').not.toBeNull();
  const box = await locator.boundingBox();
  expect(box, 'the line must have a layout box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

// The bell's writes went only through the test's own hold: none reached the net. The net's other
// catches (a write the home page may send on its own, not established) are listed in the report by
// method and path only, never by body.
function expectNoBellWriteInNet(hold: WriteHold): void {
  const held = hold.held.map((request) => `${request.method} ${new URL(request.url).pathname}`);
  test.info().annotations.push({ type: 'held-writes', description: held.join(', ') || 'none' });
  expect(held.filter((entry) => /\/(invites|friendships)\//.test(entry))).toEqual([]);
}

test.describe('notification bell actions — phone (375)', () => {
  // Runs ONLY in the phone project (both journeys and phone glob every e2e/*.spec.ts), the
  // e2e/feedback-stacking.spec.ts guard.
  test.skip(({ isMobile }) => !isMobile, 'phone-project block — the row variant lives in the phone hamburger');

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('notification bell actions — phone: Accept keeps focus while it works, then focus moves to the next row', async ({ page }) => {
    const hold = await holdWrites(page, { answerGet: answersFor([INVITE_A, INVITE_B], () => []) });
    const accept = await holdUntilReleased(page, 'POST', /\/invites\/e2e-bell-invite-a\/accept$/);
    await page.goto('/');
    const region = await openBellPanel(page);

    const acceptAlpha = region.getByRole('button', { name: 'Accept invite to E2E Bell Alpha', exact: true });
    await expect(acceptAlpha).toBeVisible();
    await acceptAlpha.click();
    await accept.arrived;

    // In flight: the same control, named by its visible N2 words, gated by aria-disabled and
    // still focused; its sibling is natively disabled.
    const pressed = region.getByRole('button', { name: 'Accepting...', exact: true });
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');
    await expect(pressed).toBeFocused();
    await expect(region.getByRole('button', { name: 'Decline invite to E2E Bell Alpha', exact: true })).toBeDisabled();
    expect(accept.count()).toBe(1);

    await accept.release({ success: true });
    await expect(
      region.getByRole('listitem').filter({ has: page.getByText('E2E Bell Alpha', { exact: true }) }),
    ).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Accept invite to E2E Bell Beta', exact: true })).toBeFocused();
    await expect(region).toBeVisible();
    const joined = region.getByText('Joined E2E Bell Alpha!', { exact: true });
    await expect(joined).toBeVisible();
    await expectInsideViewport(page, joined);
    expect(accept.count()).toBe(1);
    expectNoBellWriteInNet(hold);
  });

  test('notification bell actions — phone: a failed Accept shows the failure line inside the panel and keeps the row', async ({ page }) => {
    const hold = await holdWrites(page, { answerGet: answersFor([INVITE_A, INVITE_B], () => []) });
    const accept = await holdUntilReleased(page, 'POST', /\/invites\/e2e-bell-invite-a\/accept$/);
    // Released before the press: the accept is answered on arrival with a code-less 418, which
    // classifies as unknown (src/lib/api.ts, statusToCode, anchor return 'unknown';), so the
    // panel shows copy row N3.
    await accept.release({}, 418);
    await page.goto('/');
    const region = await openBellPanel(page);

    const acceptAlpha = region.getByRole('button', { name: 'Accept invite to E2E Bell Alpha', exact: true });
    await expect(acceptAlpha).toBeVisible();
    await acceptAlpha.click();

    const alert = region.getByRole('alert');
    await expect(alert).toHaveText(N3);
    await expectInsideViewport(page, alert);
    await expect(region.getByText('E2E Bell Alpha', { exact: true })).toBeVisible();
    expect(accept.count()).toBe(1);
    expectNoBellWriteInNet(hold);
  });

  test('notification bell actions — phone: a friend request stays while its Accept works, then focus moves to the next one', async ({ page }) => {
    // The server lists both requests until the accept is answered, then only Ben's.
    let released = false;
    const hold = await holdWrites(page, {
      answerGet: answersFor([], () => (released ? [REQUEST_B] : [REQUEST_A, REQUEST_B])),
    });
    const accept = await holdUntilReleased(page, 'POST', /\/friendships\/e2e-bell-request-a\/accept$/);
    await page.goto('/');
    const region = await openBellPanel(page);

    const acceptAna = region.getByRole('button', { name: 'Accept friend request from E2E Bell Ana', exact: true });
    await expect(acceptAna).toBeVisible();
    await acceptAna.click();
    await accept.arrived;

    // Plan 88.6.1-66: the row stays while the request runs, so the in-flight words paint.
    const pressed = region.getByRole('button', { name: 'Accepting...', exact: true });
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');
    await expect(pressed).toBeFocused();
    await expect(region.getByText('E2E Bell Ana', { exact: true })).toBeVisible();

    released = true;
    await accept.release({});
    await expect(
      region.getByRole('listitem').filter({ has: page.getByText('E2E Bell Ana', { exact: true }) }),
    ).toHaveCount(0);
    await expect(
      region.getByRole('button', { name: 'Accept friend request from E2E Bell Ben', exact: true }),
    ).toBeFocused();
    await expect(region).toBeVisible();
    const accepted = region.getByText('Accepted friend request!', { exact: true });
    await expect(accepted).toBeVisible();
    await expectInsideViewport(page, accepted);
    expect(accept.count()).toBe(1);
    expectNoBellWriteInNet(hold);
  });
});
