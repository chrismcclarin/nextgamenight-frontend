import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Phase 88.6.1-13 — the Email section when a Save's answer cannot be read (D-11, D-11a).
 *
 * WHAT THIS PROVES THAT JSDOM CANNOT. The colocated unit suite pins the reconcile rules and
 * the lanes; it cannot show a real 375px layout or where focus really lands after the
 * reconcile. This spec drives the real page at the `phone` project's 375 x 667 viewport:
 *   1. With the change PENDING on the server, a Save whose answer is unreadable lands in the
 *      code panel — code input focused, the line "We sent a code to {address}" with no
 *      period, nothing past the right edge.
 *   2. With NOTHING pending, the same Save shows its error beside Save — one alert in the
 *      card, no `aria-invalid` on the address, Save's description pointing at the alert, and
 *      focus left on Save (AT-4 R4).
 *
 * CHROMIUM, NOT WEBKIT. The `phone` project spreads the iPhone SE preset and then forces
 * `browserName: 'chromium'` (`playwright.config.ts`, `DECISION Phase 87.7 D-14`), so this is
 * a 375px Chromium-emulation proof. Chromium focuses a pressed button and iOS Safari does
 * not, so "focus stays on Save" is NOT measured on an iPhone here — that half is an owed
 * device item for plan 88.6.1-57's real-device pass.
 *
 * NOT RUN LOCALLY — typecheck and collection are the only local proof. The `phone` project
 * depends on the `setup` project, which signs in with credentials that are CI secrets, and
 * there is no `.auth/user.json` in the tree. CI's `e2e` job is the proof.
 *
 * DECISION Phase 88.6.1-13 (fixture): the request-change POST is FULFILLED in the browser by
 * `page.route` with a drifted body, chosen OVER a real request — a real one would mint a real
 * token, mail the e2e inbox, and could never produce a drifted body. The self GET is fetched
 * for REAL and patched only after that POST (adding the pending change the test asks for),
 * chosen OVER a backend fixture, which is cross-repo and out of scope. Nothing reaches the
 * backend's email routes, so the e2e account's real state is never changed. The Sentry tunnel
 * is aborted so a future CI DSN cannot turn each run into a Sentry event; no environment value
 * is printed and no screenshot is taken. Changing the fixture shape is a decision, not a
 * cleanup.
 *
 * Selector policy: role, label and text locators only — never Tailwind classes.
 */

/** The Email card is a top-level card on the profile page, not behind a tab. */
const PROFILE_PATH = '/userProfile';

const TYPED_ADDRESS = 'E2E.Drift.Check@Example.com';
/** The server's normaliser is trim + lowercase, so the pending row holds this form. */
const SERVER_ADDRESS = TYPED_ADDRESS.trim().toLowerCase();
const SENT_LINE = `We sent a code to ${SERVER_ADDRESS}`;

/** A zero-count locator makes every later assertion vacuous — guard it explicitly. */
async function guardResolved(locator: Locator, what: string): Promise<void> {
  await expect(
    locator.first(),
    `locator for ${what} resolved no visible element — a failure of the LOCATOR or of the e2e account's fixture state, not of the 88.6.1-13 work`,
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Register the routes BEFORE navigation. `withPending` decides whether the self row the
 * section refetches after the drifted Save carries the change as pending.
 */
async function routeDriftedSave(page: Page, withPending: boolean): Promise<void> {
  let posted = false;

  // The Sentry tunnel (`next.config.js` `tunnelRoute: "/monitoring"`).
  await page.route(
    (url) => url.pathname === '/monitoring',
    (route) => route.abort(),
  );

  // The request-change POST, `usersAPI.requestEmailChange` — `/users/<id>/email` under the
  // same-origin BFF base `/api`. Answered with a body that fails the response schema.
  await page.route(
    (url) => /^\/api\/users\/[^/]+\/email$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      posted = true;
      await route.fulfill({ status: 200, json: { outcome: 'unreadable-on-purpose' } });
    },
  );

  // The self GET, `usersAPI.getUser` — `/users/<encoded sub>` plus an optional `timezone`
  // query. Fetched for real; patched only for the refetch that follows the drifted POST.
  await page.route(
    (url) => /^\/api\/users\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      if (!posted || !withPending) {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(body, 'pending_email_change')) {
        await route.fulfill({ response, json: body });
        return;
      }
      await route.fulfill({
        response,
        json: {
          ...body,
          pending_email_change: {
            address: SERVER_ADDRESS,
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          },
        },
      });
    },
  );
}

/** Open the profile, find the Email card, open its editor and type the address. */
async function openEditorAndType(page: Page): Promise<Locator> {
  await page.goto(PROFILE_PATH);
  const card = page.getByRole('region', { name: 'Email', exact: true });
  await guardResolved(card, 'the Email card on /userProfile');
  const change = card.getByRole('button', { name: 'Change', exact: true });
  // A missing Change means the e2e account's email state is not idle (a pending change on
  // the server, or no readable row) — a fixture problem, not this plan's.
  await guardResolved(change, "the Email card's Change button (the e2e account must have no pending email change)");
  await change.click();
  const address = card.getByLabel(/new email address/i);
  await expect(address).toBeFocused();
  await address.fill(TYPED_ADDRESS);
  return card;
}

async function viewportWidth(page: Page): Promise<number> {
  return page.evaluate(() => window.innerWidth);
}

async function noHorizontalPageScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'the page must not scroll sideways at 375px').toBeLessThanOrEqual(innerWidth);
}

// DECISION Phase 88.6.1 code review WR-02: no capture of any kind on this spec, chosen OVER the
// shared failure screenshot and the retry trace (playwright.config.ts use.screenshot
// 'only-on-failure', use.trace 'on-first-retry', retries 1 in CI), which this spec's header
// promised it did not take. the Email card shows the e2e account's real address, and a retry trace records the real self-row response this spec fetches with route.fetch(), and CI uploads test-results from a public repository: the
// e2e/friend-invite-panel-header.spec.ts rule (DECISION Phase 88.6.1-27). Re-enabling capture
// here is a decision, not a cleanup.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test.describe('Email change — an answer the app cannot read (88.6.1-13)', () => {
  // Every spec joins BOTH projects (`journeys` and `phone` share `testMatch`); this is a
  // phone-tenet check measured at 375px, so the desktop project skips it.
  test.skip(({ isMobile }) => !isMobile, 'a 375px phone check — phone project only');

  test('Email change — a Save the app cannot read lands in the code panel when the change is pending (88.6.1-13)', async ({
    page,
  }) => {
    await routeDriftedSave(page, true);
    const card = await openEditorAndType(page);

    await card.getByRole('button', { name: 'Save', exact: true }).click();

    const codeInput = card.getByLabel(/code from the email/i);
    await expect(codeInput).toBeFocused({ timeout: 15_000 });

    // Exact text: the visible line plus the always-mounted sr-only region carrying the same
    // words. No period (copy row P2 per D-32 R7).
    const lines = card.getByText(SENT_LINE, { exact: true });
    await expect(lines).toHaveCount(2);
    await expect(card.getByText(`${SENT_LINE}.`, { exact: true })).toHaveCount(0);

    const width = await viewportWidth(page);
    const lineBoxes = await lines.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, right: r.right };
      }),
    );
    const visibleLine = lineBoxes.reduce((a, b) => (b.width > a.width ? b : a));
    expect(visibleLine.width, 'the sent line is painted, not only in the screen-reader region').toBeGreaterThan(1);
    expect(visibleLine.right).toBeLessThanOrEqual(width);

    const codeBox = await codeInput.boundingBox();
    const verify = card.getByRole('button', { name: 'Verify', exact: true });
    const verifyBox = await verify.boundingBox();
    expect(codeBox, 'the code input has a box').not.toBeNull();
    expect(verifyBox, 'Verify has a box').not.toBeNull();
    expect(codeBox!.x + codeBox!.width).toBeLessThanOrEqual(width);
    expect(verifyBox!.x + verifyBox!.width).toBeLessThanOrEqual(width);
    expect(verifyBox!.height, 'Verify meets the 44px floor').toBeGreaterThanOrEqual(44);

    await noHorizontalPageScroll(page);
  });

  test('Email change — a Save the app cannot read, with nothing pending, shows the error beside Save (88.6.1-13)', async ({
    page,
  }) => {
    await routeDriftedSave(page, false);
    const card = await openEditorAndType(page);

    const save = card.getByRole('button', { name: 'Save', exact: true });
    // Pressed, not submitted with Enter: the Enter path leaves focus in the field by
    // construction, so only a press can show where the failure leaves focus.
    await save.click();

    const alert = card.getByRole('alert');
    await expect(alert).toHaveCount(1, { timeout: 15_000 });
    await expect(alert).toBeVisible();

    const address = card.getByLabel(/new email address/i);
    await expect(address).not.toHaveAttribute('aria-invalid', 'true');

    const alertId = await alert.getAttribute('id');
    expect(alertId, 'the alert carries the id Save points at').toBeTruthy();
    await expect(save).toHaveAttribute('aria-describedby', alertId!);

    // AT-4 R4 — the 375px Chromium-emulation proof that a failure which is not about the
    // address leaves focus where the press left it. Not a WebKit result (see the header).
    await expect(save).toBeFocused();

    const width = await viewportWidth(page);
    const saveBox = await save.boundingBox();
    const alertBox = await alert.boundingBox();
    expect(saveBox, 'Save has a box').not.toBeNull();
    expect(alertBox, 'the alert has a box').not.toBeNull();
    expect(alertBox!.y, 'the alert sits below the buttons').toBeGreaterThanOrEqual(saveBox!.y + saveBox!.height);
    expect(alertBox!.x + alertBox!.width).toBeLessThanOrEqual(width);

    await noHorizontalPageScroll(page);
  });
});
