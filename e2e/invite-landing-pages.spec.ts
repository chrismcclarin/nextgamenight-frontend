import { test, expect, type Locator, type Page } from '@playwright/test';
import { scrubbedFetch } from './support/scrubbedFetch';

// Phase 88.6.1 plan 19 — the two invite landing pages, proven in a real browser at phone width
// (outline shared rule 9: the phone is the primary surface; the `phone` project is the iPhone SE
// preset, 375 x 667).
//
// Both tests run SIGNED OUT: an invite link is opened from a text message by someone who may have
// no session, and signed out neither page issues a join POST, so nothing here can write data.
//
// The only network the spec touches is the PUBLIC preview GET of each page (a direct, cross-origin
// `publicFetch` to the backend, not the same-origin proxy). Each route is registered BEFORE
// `page.goto`, matched by pathname, and every fulfilled response is built from `route.fetch()` so
// it keeps the backend's own CORS headers (the e2e/padding-budget.spec.ts rewrite idiom). The
// real preview is fetched only to copy those headers — the token is made up, so its body is a 404
// that is replaced. A transport failure is `route.abort('failed')`. Nothing is passed through to
// the network unmodified. Assertion messages carry fixed strings only.
//
// CI-only: the `phone` and `journeys` projects need the `.auth/` state the CI `e2e` job creates.

const TOKEN = 'e2e0'.repeat(16); // 64 hex characters, matching no real invite

test.use({ storageState: { cookies: [], origins: [] } });

/** A promise the test releases by hand, to hold a response while the page shows its loading state. */
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

test.describe('invite landing pages at phone width (88.6.1-19)', () => {
  test('game invite: a keyboard Retry lands focus on the settled heading, and the loading line fits (88.6.1-19)', async ({
    page,
  }) => {
    const hold = gate();
    let calls = 0;
    await page.route(
      (url) => url.pathname.includes('/events/invite-preview/'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.abort();
          return;
        }
        calls += 1;
        if (calls === 1) {
          // The first load fails at the transport layer: the page offers Retry.
          await route.abort('failed');
          return;
        }
        await hold.released;
        const response = await scrubbedFetch(route);
        await route.fulfill({
          response,
          status: 200,
          json: { game_name: 'E2E Invite Game', event_date: '2030-01-15T12:00:00Z' },
        });
      },
    );

    await page.goto(`/invite/game/${TOKEN}`);

    await expect(
      page.getByRole('heading', { level: 1, name: "Couldn't join game night" }),
    ).toBeVisible({ timeout: 15_000 });

    // Keyboard, not a pointer: Retry is focused and activated with Enter.
    await page.getByRole('button', { name: 'Retry' }).focus();
    await page.keyboard.press('Enter');

    const loading = page.getByText('Loading your game night invite...', { exact: true });
    await expect(loading).toBeVisible();
    await expectInsideViewport(page, loading);

    hold.release();

    await expect(page.getByRole('heading', { level: 1, name: 'E2E Invite Game' })).toBeFocused();
    await expectNoHorizontalScroll(page);
  });

  test('group invite: the loading line fits, and a failed preview is not called an invalid link (88.6.1-19)', async ({
    page,
  }) => {
    const hold = gate();
    await page.route(
      (url) => url.pathname.includes('/groups/invite-preview/'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.abort();
          return;
        }
        await hold.released;
        const response = await scrubbedFetch(route);
        await route.fulfill({ response, status: 500, json: { error: 'boom' } });
      },
    );

    await page.goto(`/invite/group/${TOKEN}`);

    const loading = page.getByText('Loading your group invite...', { exact: true });
    await expect(loading).toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page, loading);

    hold.release();

    await expect(page.getByRole('heading', { level: 1, name: 'Unable to join group' })).toBeVisible();
    await expect(page.getByText('This invite link is no longer valid.', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('Something went wrong on our end. Please try again shortly.', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
