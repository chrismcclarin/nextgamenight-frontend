import { test, expect, type Route } from '@playwright/test';

import { assertTheme } from './support/contrast';
import { expectGatedPair, expectNoApiWrites, holdWrites } from './support/inFlight';
import { scrubbedFetch } from './support/scrubbedFetch';

// Phase 88.6.1-47 (D-35 / AC-12, copy row E6): the event page's Share Game QR button, seen in a
// real browser at 375px (the phone project, iPhone SE 375x667, dark).
//
// WHAT THIS PROVES THAT JSDOM CANNOT. jsdom never blurs a disabled element (C-11 in
// .planning/codebase/FE-TESTING-CONVENTIONS.md), so src/app/gameDetail/page.test.tsx (Q1-Q3)
// pins the attributes, the label and the request count but cannot prove focus, paint or the QR
// dialog's focus return. Here, in Chromium:
//   1. after Enter, the pressed button keeps focus while the code loads, reads the E6 label
//      "Loading QR code...", carries aria-disabled with no disabled attribute, and paints the
//      gated accent pair at opacity 1 (the owner's answer 2Q, recorded 2026-10-16 by plan
//      88.6.1-22);
//   2. a second Enter while it loads sends no second request (single flight);
//   3. when the QR dialog closes on Escape, focus comes back to the button (W014 case 1 at its
//      source: the button kept focus, so the dialog recorded it as its opener);
//   4. the longer label causes no horizontal overflow at 375px.
//
// WHAT IS TRUE OF THE NETWORK (review #113). One route on the events API, registered before
// navigation:
//   - the invite-token request is HELD in the browser and fulfilled locally with a fake URL; it
//     never reaches the backend (the backend lazily mints a token on that GET);
//   - the event GET is fetched from the backend and PATCHED in the browser: the CI fixture event
//     (periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js, `const event = await
//     Event.create({`) is created with NO participations, and the Participants card that holds
//     this button renders only when there is at least one. When the list is missing or empty the
//     spec supplies ONE custom participant: a typed-in name with no account (user_id null), so no
//     invite or friend affordance can fire for it;
//   - every other request passes through unmodified.
// The shared write HOLD (e2e/support/inFlight.ts holdWrites, DECISION Phase 88.6.1-43) is
// registered before the events route, so every POST / PUT / PATCH / DELETE stays inside the
// browser, and the test's LAST assertion (expectNoApiWrites) is that none reached /api/, so a
// later change that adds a write on page load or on the press reds this spec without ever
// reaching the shared CI fixture account. [88.6.1 code review WR-03: it was a recorder that only
// observed, so a regressed write landed on the fixture before the test failed.] No body is ever
// logged or attached, and nothing on this page is captured (the QR dialog paints an invite
// link): see the capture-off DECISION below.
//
// PHONE ONLY, and CI ONLY like every spec here (C-14): the phone project needs the setup
// project's login, whose credentials exist only in CI. Typecheck and listing are the local
// proof; the CI e2e job is the proof. Selectors are role, label and text only.

// DECISION Phase 88.6.1 code review WR-02: no capture of any kind on this spec, chosen OVER the
// shared failure screenshot and the retry trace (playwright.config.ts use.screenshot
// 'only-on-failure', use.trace 'on-first-retry', retries 1 in CI). The QR dialog paints an
// invite link, a retry trace records network responses, and CI uploads test-results from a
// public repository: the e2e/friend-invite-panel-header.spec.ts rule (DECISION Phase 88.6.1-27).
// Re-enabling capture here is a decision, not a cleanup.
// [AMENDED 2026-10-25, code review A-IN-03: since Phase 88.6.2-27 test-results leave CI only
// as age ciphertext (scripts/encrypt-evidence.sh), so the public-upload premise no longer
// holds. The choice stands, as amended on the 88.6.1-27 rule: the invite link would still
// reach a retained artifact, and the encryption is a second net, not a reason to capture.]
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test.skip(
  ({ isMobile }) => !isMobile,
  '88.6.1-47: the pressed Share Game QR is a phone-forward check (375x667), so this spec runs only in the phone project',
);

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI. Same obviously-fake
// fallback idiom and the SAME VARIABLE NAMES as e2e/contrast.spec.ts, so a fixture rename moves
// every spec together.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

const SHARE = 'Share Game QR';
// Copy row E6, byte-equal to 88.6.1-COPY-TABLE.html (three ASCII dots).
const LOADING = 'Loading QR code...';
const FAKE_INVITE_URL = 'https://example.test/e2e-qr';
const EVENT_GET_PATH = /^\/api\/events\/[^/]+$/;

const CUSTOM_PARTICIPANT = {
  user_id: null,
  username: 'E2E participant',
  is_guest: true,
  is_custom: true,
};

test('Share Game QR stays focused and single-flight while the QR loads, and the QR dialog hands focus back (D-35, AC-12) — 375px', async ({
  page,
}) => {
  // The write hold, before navigation and before the events route (Playwright runs the newest
  // matching handler first, so the events route's fallback lands in the hold).
  const hold = await holdWrites(page);

  // The one events route, before navigation.
  const heldTokens: Route[] = [];
  let tokenRequests = 0;
  await page.route('**/api/events/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/invite-token')) {
      // HELD: never continued, never fetched. Fulfilled below with a fake URL.
      tokenRequests += 1;
      heldTokens.push(route);
      return;
    }
    if (request.method() === 'GET' && EVENT_GET_PATH.test(pathname)) {
      const response = await scrubbedFetch(route);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const event = body as { EventParticipations?: unknown };
        if (!Array.isArray(event.EventParticipations) || event.EventParticipations.length === 0) {
          event.EventParticipations = [CUSTOM_PARTICIPANT];
        }
      }
      await route.fulfill({ response, json: body });
      return;
    }
    await route.fallback();
  });

  await page.goto(E2E_EVENT_DETAIL_PATH);
  await assertTheme(page, 'dark');

  const share = page.getByRole('button', { name: SHARE });
  await expect(
    share,
    'Share Game QR never rendered. It needs the Participants card (the spec patches one custom participant into the ' +
      'event GET — check the /api/events/<id> intercept) and a group-member caller (the button is group-member-only)',
  ).toBeVisible({ timeout: 15_000 });

  await share.focus();
  await page.keyboard.press('Enter');

  const loading = page.getByRole('button', { name: LOADING });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('aria-disabled', 'true');
  await expect(loading).not.toHaveAttribute('disabled', /.*/);
  expect(
    await loading.evaluate((el) => el === document.activeElement),
    'the pressed button keeps focus while the QR loads (a native disabled attribute would drop it)',
  ).toBe(true);
  await expect.poll(() => tokenRequests, { message: 'the press sent the invite-token request' }).toBe(1);

  // Answer 2Q (owner, 2026-10-16, recorded by plan 88.6.1-22): the gated accent pair, at opacity 1.
  await expectGatedPair(page, loading, 'accent', 'dark');

  await page.keyboard.press('Enter');
  // A refused press produces no event to wait on: there is nothing to poll for, so give a
  // second request a fixed window in which it would have been issued, then count.
  await page.waitForTimeout(300);
  expect(tokenRequests, 'a second Enter while the QR loads sends no second request').toBe(1);
  await expect(loading).toHaveAttribute('aria-disabled', 'true');

  for (const route of heldTokens) {
    const origin = route.request().headers()['origin'];
    await route.fulfill({
      status: 200,
      json: { invite_url: FAKE_INVITE_URL },
      headers: origin
        ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
        : {},
    });
  }

  const dialog = page.getByRole('dialog', { name: 'Game Night Invite QR' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const idle = page.getByRole('button', { name: SHARE });
  await expect
    .poll(() => idle.evaluate((el) => el === document.activeElement), {
      message: 'closing the QR dialog hands focus back to Share Game QR (W014 case 1)',
    })
    .toBe(true);
  await expect(idle).not.toHaveAttribute('aria-disabled', /.*/);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'no horizontal overflow at 375px',
  ).toBe(true);

  // No write reached /api/ on page load or on the press (held in the browser, never sent).
  expectNoApiWrites(hold);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
