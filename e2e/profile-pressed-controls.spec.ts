import { test, expect, type Page, type Route } from '@playwright/test';

import { focusByKeyboard } from './support/contrast';
import { expectNoApiWrites, holdUntilReleased, holdWrites, type WriteHold } from './support/inFlight';
import { expectFocusRingClearOfText } from './support/ringGeometry';

// Phase 88.6.1 plan 18 (Requirement 4 / D-35, Requirement 5): the Profile page's two pressed
// controls, the phone Verify button and Replay Tutorial, seen in a real browser.
//
// WHAT THIS CHECKS THAT JSDOM CANNOT. The jsdom suite (`src/app/userProfile/page.test.tsx`, the
// two 88.6.1-18 describes) pins the attributes, the request counts and the focus hook, but jsdom
// never blurs a disabled control (C-11 in .planning/codebase/FE-TESTING-CONVENTIONS.md), so it
// cannot prove the focus claims. Here: each pressed control KEEPS focus while its request is in
// flight and refuses a second Enter; a successful check lands focus on "Phone verified"; and at
// 375px the in-flight label causes no horizontal overflow.
//
// BOTH PROJECTS ON PURPOSE. `phone` (375 x 667) and `journeys` (desktop) both run every test: the
// focus contract holds at every width. The overflow check is the phone project's only.
//
// NOT RUN LOCALLY. Both projects depend on the `setup` project, which drives Auth0 Universal
// Login with credentials that are deliberately absent locally (C-14). Typecheck and listing are
// the local proof; the CI e2e job is the proof.
//
// NOTHING IS WRITTEN TO THE BACKEND. Every intercept is registered BEFORE `page.goto`, matches
// by pathname suffix and method, and counts what it sees:
//   - POST .../phone (send a code): answered in the browser. Reaching the backend would write the
//     fixture user's phone and start a real Twilio verification.
//   - POST .../phone/verify: HELD, then answered { verified: true } in the browser on release.
//   - DELETE .../tutorial (reset): HELD, then answered { tutorial_version: 0 } on release.
//     Reaching the backend would reset the fixture user's tutorial and auto-open it in every
//     later spec.
//   - PUT .../tutorial (complete): answered at once, a safety net so an auto-advancing tutorial
//     step never writes the fixture user's tutorial state.
// These write handlers only ever answer; none hands a request on in any form.
//   - The self lookup (patchSelfRow) is the ONE handler that reads the real response: a GET
//     of /users/<Auth0 sub> is answered with the real body plus the test's own fields (the Verify
//     test: `sms_enabled: true`, `phone: null`, `phone_verified: false`, so the phone block renders
//     in its first state). Any other method on that path is passed on untouched.
//
// Phase 88.6.1 plan 53 appends a second describe (Requirement 5 / Requirement 4): Change number
// lands focus on the Phone number field; Remove keeps focus and refuses a second press while its
// removal is held, then lands focus on the banner statement; the banner's Dismiss ring is measured
// (confirm-only) and its press lands focus on the field. Its own intercepts are listed there.

// In the 555-01xx fictional range, so it is never a real person's phone, and it still passes the
// page's own check (`parsePhoneNumber(value, 'US')` then `isValid()`,
// `src/app/userProfile/page.js:574-575`; `isValid()` is true for this value, run 2026-10-11 and
// again 2026-10-15).
const FAKE_PHONE = '(201) 555-0123';
const FAKE_CODE = '123456';

interface Held {
  /** How many matching requests reached the browser-side handler. */
  count: () => number;
  /** Resolves when the first matching request arrives (it is then held). */
  arrived: Promise<void>;
  /** Answers every held request, and every later one at once. */
  release: () => void;
}

function heldResponder(status: number, json: Record<string, unknown>): {
  held: Held;
  take: (route: Route) => Promise<void>;
} {
  let count = 0;
  let released = false;
  const waiting: Route[] = [];
  let markArrived!: () => void;
  const arrived = new Promise<void>((resolve) => {
    markArrived = resolve;
  });
  return {
    held: {
      count: () => count,
      arrived,
      release: () => {
        released = true;
        for (const route of waiting.splice(0)) void route.fulfill({ status, json });
      },
    },
    take: async (route: Route) => {
      count += 1;
      markArrived();
      if (released) {
        await route.fulfill({ status, json });
        return;
      }
      waiting.push(route);
    },
  };
}

interface WriteMocks {
  savePosts: () => number;
  verify: Held;
  reset: Held;
  completePuts: () => number;
}

// The write intercepts, shared by both tests. Each handler only ever answers in the browser.
async function interceptWrites(page: Page): Promise<WriteMocks> {
  let savePosts = 0;
  await page.route(
    (url) => url.pathname.endsWith('/phone'),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, json: {} });
        return;
      }
      savePosts += 1;
      await route.fulfill({ status: 200, json: { status: 'verification_sent' } });
    },
  );

  const verify = heldResponder(200, { verified: true });
  await page.route(
    (url) => url.pathname.endsWith('/phone/verify'),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, json: {} });
        return;
      }
      await verify.take(route);
    },
  );

  // One handler for the one path: DELETE is the held reset, PUT the completion safety net.
  const reset = heldResponder(200, { tutorial_version: 0 });
  let completePuts = 0;
  await page.route(
    (url) => url.pathname.endsWith('/tutorial'),
    async (route) => {
      const method = route.request().method();
      if (method === 'DELETE') {
        await reset.take(route);
        return;
      }
      if (method === 'PUT') {
        completePuts += 1;
        await route.fulfill({ status: 200, json: { tutorial_version: 3 } });
        return;
      }
      await route.fulfill({ status: 405, json: {} });
    },
  );

  return {
    savePosts: () => savePosts,
    verify: verify.held,
    reset: reset.held,
    completePuts: () => completePuts,
  };
}

function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// The self lookup: /users/<one segment> where the decoded segment is an Auth0 sub (has a pipe).
// The real body is fetched and answered with `fields` merged over it; the last merged body is kept,
// so a later write can be answered with the row the page would get back (plan 88.6.1-53 moved the
// fixed fields to a parameter; one function, no copy).
async function patchSelfRow(
  page: Page,
  fields: Record<string, unknown>,
): Promise<{ lastBody: () => Record<string, unknown> | null }> {
  let last: Record<string, unknown> | null = null;
  await page.route(
    (url) => {
      const match = /\/users\/([^/]+)$/.exec(url.pathname);
      return match !== null && decodedSegment(match[1]).includes('|');
    },
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        await route.fulfill({ response });
        return;
      }
      last = { ...(body as Record<string, unknown>), ...fields };
      await route.fulfill({ response, json: last });
    },
  );
  return { lastBody: () => last };
}

test.describe('Profile pressed controls (plan 88.6.1-18)', () => {
  test('phone Verify: the pressed button keeps focus and reads "Verifying..." in flight, a second Enter sends nothing, and focus lands on "Phone verified" after success', async ({ page }, testInfo) => {
    const mocks = await interceptWrites(page);
    await patchSelfRow(page, { sms_enabled: true, phone: null, phone_verified: false });
    await page.goto('/userProfile');

    await page.getByRole('textbox', { name: 'Phone number' }).fill(FAKE_PHONE);
    await page.getByRole('button', { name: 'Save & Verify' }).click();

    const code = page.getByRole('textbox', { name: 'Verification code' });
    // A missing control is a failure, never a skip.
    await expect(code).toBeVisible({ timeout: 15_000 });
    await code.fill(FAKE_CODE);

    // Scoped to the code row: the SMS rows carry a second button named "Verify".
    // The name matches BOTH labels of this one control, idle "Verify" and in-flight "Verifying..."
    // (userProfile/page.js, VERIFY_CODE_IN_FLIGHT_LABEL, no aria-label), so the locator follows the
    // same button through its label flip. An exact "Verify" locator stopped matching once the label
    // flipped, and every in-flight assertion failed with "element(s) not found" (CI run 38878098281,
    // both projects). The idle name is asserted before the press, so nothing the old locator
    // implied is lost.
    const verify = code.locator('xpath=..').getByRole('button', { name: /^Verif(y|ying\.\.\.)$/ });
    await expect(verify).toHaveText('Verify');
    await verify.focus();
    await page.keyboard.press('Enter');
    await mocks.verify.arrived;

    // While the check is held: the pressed control stays focused and focusable (D-35).
    await expect(verify).toBeFocused();
    await expect(verify).toHaveAttribute('aria-disabled', 'true');
    await expect(verify).not.toHaveAttribute('disabled');
    await expect(verify).toHaveText('Verifying...');

    if (testInfo.project.name === 'phone') {
      // The measurement is provably at phone width, and the in-flight label fits.
      expect(page.viewportSize()?.width).toBe(375);
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(fits, 'horizontal overflow at 375px while "Verifying..." shows').toBe(true);
    }

    // The latch refuses a second press.
    await page.keyboard.press('Enter');
    await expect(verify).toHaveText('Verifying...');
    expect(mocks.verify.count()).toBe(1);

    mocks.verify.release();
    // Requirement 5: the success removes the button; focus lands on the settled text.
    await expect(page.getByText('Phone verified', { exact: true })).toBeFocused();

    expect(mocks.verify.count()).toBe(1);
    expect(mocks.savePosts()).toBe(1);
  });

  test('Replay Tutorial: the pressed button keeps focus and reads "Starting..." in flight, and a second Enter sends no second reset', async ({ page }) => {
    const mocks = await interceptWrites(page);
    await page.goto('/userProfile');

    const replay = page.getByRole('button', { name: 'Replay Tutorial' });
    await expect(replay).toBeVisible({ timeout: 15_000 });
    await replay.scrollIntoViewIfNeeded();
    await replay.focus();
    await page.keyboard.press('Enter');
    await mocks.reset.arrived;

    // The label changed, so re-locate by role on the same control's in-flight name.
    const pressed = page.getByRole('button', { name: 'Starting...' });
    await expect(pressed).toBeFocused();
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');
    await expect(pressed).toHaveText('Starting...');

    await page.keyboard.press('Enter');
    await expect(pressed).toHaveText('Starting...');
    expect(mocks.reset.count()).toBe(1);

    mocks.reset.release();
    // The tour opened. Where focus goes from here is the v2.1 tutorial rewrite's (D-49, AC-16
    // struck), so nothing is asserted about it and the tour is left as it is.
    await expect(page.getByRole('button', { name: 'Skip tutorial' })).toBeVisible({ timeout: 15_000 });
    expect(mocks.reset.count()).toBe(1);
  });
});

// Phase 88.6.1 plan 53. A verified number on the fixture row, so the verified row (Change number,
// Remove) renders. A real, fictional-range number; it is never sent anywhere.
const VERIFIED_PHONE = '+14155552671';
const BANNER = 'SMS disabled — add a phone number to re-enable.';

// The write ledger (T-88.6.1-1062), complete by construction: every write the page can send is
// either answered by one of interceptWrites' COUNTING handlers or the Remove test's counting
// DELETE hold, or it falls through to the holdWrites backstop, which keeps it in the browser and
// fails the test in afterEach. So "these counters read zero and the backstop is empty" means no
// write left the browser. DECISION Phase 88.6.1-53 (Req 4 / T-88.6.1-1062): this ledger is used
// OVER a page.on('request') recorder — that recorder already exists, describe-scoped, in
// e2e/touch-targets.spec.ts, and a second copy here is the duplication the milestone's tenet
// rejects. Changing this is a decision, not a cleanup.
function expectNoMockedWrites(mocks: WriteMocks): void {
  expect(mocks.savePosts(), 'a phone save was sent').toBe(0);
  expect(mocks.verify.count(), 'a verification check was sent').toBe(0);
  expect(mocks.reset.count(), 'a tutorial reset was sent').toBe(0);
  expect(mocks.completePuts(), 'a tutorial completion was sent').toBe(0);
}

// Intercepts, newest first (Playwright runs the newest matching handler first):
//   - DELETE .../phone (Remove test only): holdUntilReleased, answered on release with the last
//     self body merged with the cascade's fields (routes/users.js clears phone, phone_verified and
//     the SMS preferences and returns the self row, sms_enabled still set). NOT holdWrites for this
//     one: holdWrites never answers a held write, and this test must release the DELETE to see
//     where focus lands — do not "consolidate" it into the net.
//   - the self GET (patchSelfRow): the real body plus a verified number.
//   - interceptWrites: the phone / verify / tutorial writes, answered in the browser.
//   - holdWrites: the backstop net under all of them, so any write nobody mocked is held in the
//     browser and fails the test in afterEach rather than reaching the fixture account.
// Every intercept is registered BEFORE page.goto.
test.describe('Profile phone block focus and Remove in flight (plan 88.6.1-53)', () => {
  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Change number lands focus on the phone field', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const mocks = await interceptWrites(page);
    await patchSelfRow(page, { sms_enabled: true, phone: VERIFIED_PHONE, phone_verified: true });
    await page.goto('/userProfile');

    // The verified row has exactly one Change number. A missing control is a failure, never a skip.
    const change = page.getByRole('button', { name: 'Change number' });
    await expect(change).toBeVisible({ timeout: 15_000 });
    await focusByKeyboard(page, change);
    await page.keyboard.press('Enter');

    // Requirement 5: the pressed link is gone; focus is on the field it was pressed to reach.
    await expect(page.getByRole('textbox', { name: 'Phone number' })).toBeFocused();

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, 'horizontal overflow at 375px after Change number').toBe(true);
    }
    // Nothing was written (the backstop's half is checked in afterEach).
    expectNoMockedWrites(mocks);
  });

  test('Remove keeps focus, refuses a second press, then lands on the banner', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const mocks = await interceptWrites(page);
    const self = await patchSelfRow(page, { sms_enabled: true, phone: VERIFIED_PHONE, phone_verified: true });
    const removal = await holdUntilReleased(page, 'DELETE', /\/phone$/);
    await page.goto('/userProfile');

    // Its name changes while armed, so the locator follows both labels of the one control.
    const remove = page.getByRole('button', { name: /^(Remove|Tap again to remove)$/ });
    await expect(remove).toBeVisible({ timeout: 15_000 });
    await expect(remove).toHaveText('Remove');
    await focusByKeyboard(page, remove);
    await page.keyboard.press('Enter');
    await expect(remove).toHaveText('Tap again to remove');
    await page.keyboard.press('Enter');
    await removal.arrived;

    // While the removal is held: the pressed control keeps focus and is aria-disabled (Req 4).
    await expect(remove).toBeFocused();
    await expect(remove).toHaveAttribute('aria-disabled', 'true');
    await expect(remove).toHaveText('Remove');

    // The latch refuses further presses: no re-arm, no second request.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(remove).toHaveText('Remove');
    expect(removal.count()).toBe(1);

    const body = self.lastBody();
    expect(body, 'the self row was never fetched, so the DELETE has nothing to answer with').not.toBeNull();
    await removal.release({ ...body, phone: null, phone_verified: false, sms_enabled: true });

    // Requirement 5: the success removes the button; focus lands on the settled statement.
    const statement = page.getByText(BANNER, { exact: true });
    await expect(statement).toBeFocused();

    // CONFIRM-ONLY: the Dismiss ring keeps its outset form because, by class arithmetic, it stops
    // at the banner text's box edge (DECISION Phase 88.6.1-53 (V-1a / AC-23) in the page). Measured
    // here with the shared helper; it leaves Dismiss focused by keyboard.
    const dismiss = page.getByRole('button', { name: 'Dismiss' });
    await expectFocusRingClearOfText(page, dismiss, statement, 'SMS banner dismiss');

    // Review 214: dismissing unmounts the banner with the pressed button; focus lands on the field
    // the sentence named.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Phone number' })).toBeFocused();
    await expect(statement).toHaveCount(0);

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, 'horizontal overflow at 375px after Remove and Dismiss').toBe(true);
    }
    // Exactly the one held DELETE; Dismiss writes nothing (the backstop's half is in afterEach).
    expect(removal.count()).toBe(1);
    expectNoMockedWrites(mocks);
  });
});
