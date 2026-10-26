import { test, expect, type Locator, type Page } from '@playwright/test';
import { scrubbedFetch } from './support/scrubbedFetch';

// Phase 88.6.1 plan 35 — the invite/accept page, proven in a real browser at phone width (outline
// shared rule 9: the phone is the primary surface; the `phone` project is the iPhone SE preset,
// 375 x 667).
//
// SIGNED OUT: an invite link is opened from an email by someone who may have no session, and a
// signed-out visit never issues the accept POST, so nothing here can write data.
//
// Two routes are intercepted, both registered BEFORE `page.goto` and matched by pathname:
// - `/api/auth/me` (same-origin, fetched by the root UserProvider): held until the test releases
//   it, so the page's own loading line can be measured while it is on screen, then answered with
//   the real response through `scrubbedFetch(route)` (signed out, that is a 204).
// - the PUBLIC invite-info GET (a direct, cross-origin `publicFetch` to the backend, not the
//   same-origin proxy): the real response is fetched only to keep the backend's own CORS headers
//   (the e2e/padding-budget.spec.ts rewrite idiom) and its body is replaced, because the token
//   is made up and the real body is a 404.
// Nothing is passed through to the network unmodified. Assertion messages carry fixed strings only.
//
// The page's live region is addressed by its test id, never by role: the route's loading
// fallback (`RouteFallback`) is itself a status region labelled with the same words.
//
// CI-only: the `phone` and `journeys` projects need the `.auth/` state the CI `e2e` job creates.

const TOKEN = 'e2e1'.repeat(16); // 64 hex characters, matching no real invite
const PAGE_STATUS_TESTID = 'invite-accept-page-status';
const LOADING_LABEL = 'Checking your invitation...';
const INVITE_INFO = {
  inviter_name: 'E2E Inviter',
  group_name: 'E2E Invite Group',
  member_count: 3,
};

test.use({ storageState: { cookies: [], origins: [] } });

/** A promise released by hand. */
function gate() {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { released, release };
}

/** The element's right edge is inside the viewport. */
async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, 'the project must define a viewport').not.toBeNull();
  const box = await locator.boundingBox();
  expect(box, 'the element has no layout box').not.toBeNull();
  expect(box!.x + box!.width, 'the element runs past the right edge of the viewport').toBeLessThanOrEqual(
    viewport!.width,
  );
}

/** No page-level horizontal scroll. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth, 'the page scrolls horizontally').toBeLessThanOrEqual(widths.innerWidth);
}

test.describe('invite/accept at phone width (88.6.1-35)', () => {
  test('signed out: the loading line fits, the invitation has no horizontal scroll, and the region speaks the on-screen text (88.6.1-35)', async ({
    page,
  }) => {
    const authRequested = gate();
    const authHold = gate();

    await page.route(
      (url) => url.pathname === '/api/auth/me',
      async (route) => {
        authRequested.release();
        await authHold.released;
        const response = await scrubbedFetch(route);
        await route.fulfill({ response });
      },
    );

    await page.route(
      (url) => url.pathname.includes('/invites/info/'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.abort();
          return;
        }
        const response = await scrubbedFetch(route);
        await route.fulfill({ response, status: 200, json: INVITE_INFO });
      },
    );

    await page.goto(`/invite/accept?token=${TOKEN}`);
    await authRequested.released;

    // The page itself is mounted and still loading: its region exists and is empty.
    const region = page.getByTestId(PAGE_STATUS_TESTID);
    await expect(region).toBeAttached({ timeout: 15_000 });
    expect(await region.textContent(), 'the page region must be empty while auth resolves').toBe('');

    // Copy row L1, measured at 375px while it is on screen.
    const loading = page.getByText(LOADING_LABEL, { exact: true });
    await expect(loading).toHaveCount(1);
    await expect(loading).toBeVisible();
    await expectInsideViewport(page, loading);

    authHold.release();

    await expect(page.getByRole('heading', { level: 1, name: "You're invited!" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(region).toHaveText(
      "You're invited! E2E Inviter invited you to join E2E Invite Group on Next Game Night. The group has 3 members.",
    );
    await expect(page.getByRole('link', { name: 'Sign in to accept' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
