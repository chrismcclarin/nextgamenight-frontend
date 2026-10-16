import { test, expect, type Page, type Route } from '@playwright/test';

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
//   - The self lookup (Verify test only) is the ONE handler that reads the real response: a GET
//     of /users/<Auth0 sub> is answered with the real body plus `sms_enabled: true`,
//     `phone: null`, `phone_verified: false`, so the phone block renders in its first state.
//     Any other method on that path is passed on untouched.

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
async function patchSelfForPhoneFlow(page: Page): Promise<void> {
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
      await route.fulfill({
        response,
        json: { ...(body as Record<string, unknown>), sms_enabled: true, phone: null, phone_verified: false },
      });
    },
  );
}

test.describe('Profile pressed controls (plan 88.6.1-18)', () => {
  test('phone Verify: the pressed button keeps focus and reads "Verifying..." in flight, a second Enter sends nothing, and focus lands on "Phone verified" after success', async ({ page }, testInfo) => {
    const mocks = await interceptWrites(page);
    await patchSelfForPhoneFlow(page);
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
