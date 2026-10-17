import { test, expect, type Page, type Route } from '@playwright/test';

import { focusByKeyboard } from './support/contrast';
import {
  expectGatedPair,
  expectNoApiWrites,
  holdUntilReleased,
  holdWrites,
  settleAnimations,
  type ReleasableHold,
  type WriteHold,
} from './support/inFlight';
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
// `src/app/userProfile/page.js:653-654`; `isValid()` is true for this value, run 2026-10-11 and
// again 2026-10-15).
const FAKE_PHONE = '(201) 555-0123';
const FAKE_CODE = '123456';

interface WriteMocks {
  savePosts: () => number;
  verify: ReleasableHold;
  reset: ReleasableHold;
  completePuts: () => number;
}

// The write intercepts, shared by both tests. Each handler only ever answers in the browser.
// The two HELD writes (the verification check and the tutorial reset) use the shared
// release-capable hold, `holdUntilReleased` (e2e/support/inFlight.ts, plan 88.6.1-44) — one copy
// phase-wide (plan 88.6.1-59 folded this spec's own earlier copy onto it, behaviour unchanged).
// Each hold is registered AFTER its path's answering handler, so a request of another method on
// that path falls back to the handler below it and is still answered in the browser.
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

  // Any method other than the held POST is refused in the browser.
  await page.route(
    (url) => url.pathname.endsWith('/phone/verify'),
    async (route) => {
      await route.fulfill({ status: 405, json: {} });
    },
  );
  const verify = await holdUntilReleased(page, 'POST', /\/phone\/verify$/);

  // One handler for the one path: PUT is the completion safety net; the DELETE (the reset) is held
  // by the hold registered after it.
  let completePuts = 0;
  await page.route(
    (url) => url.pathname.endsWith('/tutorial'),
    async (route) => {
      const method = route.request().method();
      if (method === 'PUT') {
        completePuts += 1;
        await route.fulfill({ status: 200, json: { tutorial_version: 3 } });
        return;
      }
      await route.fulfill({ status: 405, json: {} });
    },
  );
  const reset = await holdUntilReleased(page, 'DELETE', /\/tutorial$/);

  return {
    savePosts: () => savePosts,
    verify,
    reset,
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
// fixed fields to a parameter; one function, no copy). Plan 88.6.1-61: while `failWhile` returns
// true, the lookup is answered in the browser with a 500 and is NOT fetched; otherwise unchanged.
async function patchSelfRow(
  page: Page,
  fields: Record<string, unknown>,
  options: { failWhile?: () => boolean } = {},
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
      if (options.failWhile?.()) {
        await route.fulfill({ status: 500, json: { error: 'boom' } });
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
  // The fail-closed write net (plan 88.6.1-60, carry-in from plan 59's register): registered FIRST
  // in each test so it sits UNDER interceptWrites' answering handlers and the two holds (Playwright
  // runs the newest matching handler first). Every write those answer still gets its in-browser
  // answer; any other write is held in the browser and fails the test here, never reaching the
  // fixture account. Behaviour of both tests is otherwise unchanged.
  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('phone Verify: the pressed button keeps focus and reads "Verifying..." in flight, a second Enter sends nothing, and focus lands on "Phone verified" after success', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
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

    await mocks.verify.release({ verified: true });
    // Requirement 5: the success removes the button; focus lands on the settled text.
    await expect(page.getByText('Phone verified', { exact: true })).toBeFocused();

    expect(mocks.verify.count()).toBe(1);
    expect(mocks.savePosts()).toBe(1);
  });

  test('Replay Tutorial: the pressed button keeps focus and reads "Starting..." in flight, and a second Enter sends no second reset', async ({ page }) => {
    backstop = await holdWrites(page);
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

    await mocks.reset.release({ tutorial_version: 0 });
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

// Phase 88.6.1 plan 59 (Requirement 4 / D-35, Requirement 5, Requirement 9): the availability
// forms' Save Schedule / Save Override and (Task 3) the username editor, in a real browser. Each
// pressed Save keeps focus and refuses a second Enter while its write is held, shows the gated
// primary pair, and after release focus lands on the control that opened the form.
//
// Intercepts, registered BEFORE page.goto in this order (Playwright runs the newest first):
//   - holdWrites: the fail-closed net, so any write nobody mocked is held in the browser and
//     fails the test in afterEach rather than reaching the fixture account.
//   - holdUntilReleased (the shared helper, e2e/support/inFlight.ts): the ONE write under test,
//     kept unanswered until the test releases it in the browser. Not holdWrites for this one:
//     holdWrites never answers, and these tests release the write to see where focus lands.
// Copy row RF1 (D-47), written ONCE in this spec (contract C7): plan 70's refresh notice.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

function patternRow(id: string, dayOfWeek: number): Record<string, unknown> {
  return {
    id,
    type: 'recurring_pattern',
    start_date: '2026-01-01',
    end_date: null,
    pattern_data: { dayOfWeek, startTime: '18:00', endTime: '22:00' },
  };
}

test.describe('Profile availability forms and username editor in flight (plan 88.6.1-59)', () => {
  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Save Schedule keeps focus, refuses a second press, then lands on + Add Schedule', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const create = await holdUntilReleased(page, 'POST', /\/availability\/user\/[^/]+\/recurring$/);
    await page.goto('/userProfile');

    // A missing control is a failure, never a skip.
    const toggle = page.getByRole('button', { name: '+ Add Schedule' });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    // `exact`: a bare 'Mon' is a substring match and also finds a seeded row's `Delete Monday
    // schedule` (wave 7 CI gate, run 39020174955: strict-mode, 2 elements); the day toggle's whole
    // name is `Mon`.
    await page.getByRole('button', { name: 'Mon', exact: true }).click();

    const save = page.getByRole('button', { name: /^(Save Schedule|Saving\.\.\.)$/ });
    await focusByKeyboard(page, save);
    await page.keyboard.press('Enter');
    await create.arrived;

    await expect(save).toBeFocused();
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).not.toHaveAttribute('disabled');
    await expect(save).toHaveText('Saving...');
    await expectGatedPair(page, save, 'primary', 'dark');

    await page.keyboard.press('Enter');
    expect(create.count()).toBe(1);

    await create.release(
      { id: 'e2e-created', type: 'recurring_pattern', pattern_data: { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' } },
      201,
    );
    await expect(page.getByRole('button', { name: '+ Add Schedule' })).toBeFocused();

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow after Save Schedule').toBe(true);
    expect(create.count()).toBe(1);
  });

  test('Save Override keeps focus, refuses a second press, then lands on + Add Override', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const create = await holdUntilReleased(page, 'POST', /\/availability\/user\/[^/]+\/override$/);
    await page.goto('/userProfile');

    const tab = page.getByRole('tab', { name: 'Specific Dates' });
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await tab.click();
    const toggle = page.getByRole('button', { name: '+ Add Override' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    const save = page.getByRole('button', { name: /^(Save Override|Saving\.\.\.)$/ });
    await focusByKeyboard(page, save);
    await page.keyboard.press('Enter');
    await create.arrived;

    await expect(save).toBeFocused();
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).not.toHaveAttribute('disabled');
    await expect(save).toHaveText('Saving...');
    await expectGatedPair(page, save, 'primary', 'dark');

    await page.keyboard.press('Enter');
    expect(create.count()).toBe(1);

    await create.release({ id: 'e2e-override', type: 'specific_override' }, 201);
    await expect(page.getByRole('button', { name: '+ Add Override' })).toBeFocused();

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow after Save Override').toBe(true);
    expect(create.count()).toBe(1);
  });

  test('deleting a schedule lands on + Add Schedule; a failed refresh keeps the rows under the RF1 notice', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    // The patterns read, answered in the browser from a mutable answer (GET only).
    const patterns: { status: number; body: unknown } = {
      status: 200,
      body: [patternRow('e2e-mon', 1), patternRow('e2e-tue', 2)],
    };
    await page.route(
      (url) => url.pathname.endsWith('/patterns'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: patterns.status, json: patterns.body });
      },
    );
    const removal = await holdUntilReleased(page, 'DELETE', /\/availability\/e2e-(mon|tue)$/);
    await page.goto('/userProfile');

    // Arm 1 (Requirement 5): a committed Delete keeps focus while held, then lands on the toggle.
    const monday = page.getByRole('button', { name: /^(Delete Monday schedule|Tap again to confirm)$/ });
    await expect(monday).toBeVisible({ timeout: 15_000 });
    await focusByKeyboard(page, monday);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await removal.arrived;
    await expect(monday).toBeFocused();
    patterns.body = [patternRow('e2e-tue', 2)];
    await removal.release({});
    await expect(page.getByRole('button', { name: '+ Add Schedule' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Delete Monday schedule' })).toHaveCount(0);

    // Arm 2 (AC-29 / RF1, contract C8 a + d): the re-read after the next delete answers 500.
    patterns.status = 500;
    patterns.body = { error: 'boom' };
    const tuesday = page.getByRole('button', { name: /^(Delete Tuesday schedule|Tap again to confirm)$/ });
    await focusByKeyboard(page, tuesday);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    // The Tuesday DELETE is answered at once: the shared hold was released in Arm 1, and
    // holdUntilReleased answers any later match at once after release (its `arrived` already
    // resolved on the Monday DELETE), so a held-state check here could never fail. The in-flight
    // focus property stays pinned by Arm 1. A 5xx read is retried once (shouldRetry), hence 15 s.
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    const noticeRow = retry.locator('xpath=..');
    await expect(noticeRow).toContainText(RF1);
    await expect(page.getByText("Couldn't load your schedules")).toHaveCount(0);
    const keptRow = page.getByRole('button', { name: 'Delete Tuesday schedule' });
    await expect(keptRow).toBeVisible();

    // Layout (C8 d). A red here is a STOP for the owner's mockup, never a restyle.
    await settleAnimations(noticeRow);
    const viewportWidth = page.viewportSize()?.width ?? 0;
    const retryBox = await retry.boundingBox();
    expect(retryBox, 'Retry has a box').not.toBeNull();
    if (retryBox) {
      // The 44 x 44 floor is the PHONE tenet (contract C8 d: "a phone e2e at 375px"); the shared
      // Retry row carries `min-h-11 md:min-h-0`, so `journeys` (desktop) measures the opt-out
      // (wave 7 CI gate, run 39020174955: 20px there). The edges below hold at every width.
      if (testInfo.project.name === 'phone') {
        expect(retryBox.width, 'Retry width').toBeGreaterThanOrEqual(44);
        expect(retryBox.height, 'Retry height').toBeGreaterThanOrEqual(44);
      }
      expect(retryBox.x, 'Retry left edge').toBeGreaterThanOrEqual(0);
      expect(retryBox.x + retryBox.width, 'Retry right edge').toBeLessThanOrEqual(viewportWidth);
    }
    const noSideways = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noSideways, 'sideways scroll with the notice showing').toBe(true);
    const rowBox = await noticeRow.boundingBox();
    const keptBox = await keptRow.locator('xpath=..').boundingBox();
    expect(rowBox && keptBox, 'notice row and kept row have boxes').toBeTruthy();
    if (rowBox && keptBox) {
      expect(rowBox.y + rowBox.height, 'the notice sits above the kept row').toBeLessThanOrEqual(keptBox.y);
    }

    // Arm 3 (C8 c, Requirement 5): a keyboard Retry that succeeds lands on the panel heading.
    patterns.status = 200;
    patterns.body = [];
    await focusByKeyboard(page, retry);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText('No schedules set. Add one to get started.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Availability Schedules' })).toBeFocused();

    if (testInfo.project.name === 'phone') {
      expect(viewportWidth).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow on the availability card').toBe(true);
    expect(removal.count()).toBe(2);
  });

  test('Save username keeps focus, refuses a second press, then lands on the pencil; Cancel lands there too', async ({ page }, testInfo) => {
    // The self row with no merged fields, so the last real self body is captured for the release.
    const self = await patchSelfRow(page, {});
    backstop = await holdWrites(page);
    const rename = await holdUntilReleased(page, 'PUT', /\/users\/[^/]+\/username$/);
    await page.goto('/userProfile');

    const pencil = page.getByRole('button', { name: 'Edit username' });
    await expect(pencil).toBeVisible({ timeout: 15_000 });
    await focusByKeyboard(page, pencil);
    await page.keyboard.press('Enter');
    // The field takes focus (its autoFocus). Nothing is typed: the current name is kept.
    // `exact`: a bare 'Username' is a case-insensitive substring match and also finds the BGG
    // field (`BoardGameGeek username`; wave 7 CI gate, run 39020174955: strict-mode, 2 elements).
    await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeFocused();

    const save = page.getByRole('button', { name: /^(Save|Saving\.\.\.)$/ });
    await focusByKeyboard(page, save);
    await page.keyboard.press('Enter');
    await rename.arrived;

    await expect(save).toBeFocused();
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).not.toHaveAttribute('disabled');
    await expect(save).toHaveText('Saving...');
    await expectGatedPair(page, save, 'primary', 'dark');
    // Cancel is a sibling: natively disabled while the save runs (D-35).
    await expect(save.locator('xpath=..').getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await page.keyboard.press('Enter');
    expect(rename.count()).toBe(1);

    // Answered with the captured self body: the username is unchanged.
    await rename.release(self.lastBody() ?? {});
    await expect(pencil).toBeFocused();

    // Cancel: reopen the editor from the focused pencil, then cancel by keyboard.
    await page.keyboard.press('Enter');
    const saveAgain = page.getByRole('button', { name: /^(Save|Saving\.\.\.)$/ });
    await expect(saveAgain).toBeVisible();
    const cancel = saveAgain.locator('xpath=..').getByRole('button', { name: 'Cancel' });
    await focusByKeyboard(page, cancel);
    await page.keyboard.press('Enter');
    await expect(pencil).toBeFocused();

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow around the username editor').toBe(true);
    expect(rename.count()).toBe(1);
  });
});

// Phase 88.6.1 plan 60 (Requirement 4 / D-35, Requirement 5, Requirement 8, Requirement 11): the
// "My Game Collection" card's two pressed controls, Import Collection and Search, and the import's
// outcome region and 5-second result timer, in a real browser in both projects.
//
// NOTHING IS WRITTEN TO THE BACKEND AND NOTHING REACHES BOARDGAMEGEEK. Every intercept is
// registered BEFORE `page.goto`:
//   - holdWrites: the fail-closed net, registered FIRST so it runs last; any write nobody answers
//     is held in the browser and fails the test in afterEach.
//   - POST .../user-games/user/<id>/import-bgg-collection: holdUntilReleased (the shared helper),
//     kept unanswered until the test releases it in the browser. Reaching the backend would write
//     the fixture user's collection and call BoardGameGeek server-side.
//   - GET .../games/bgg/search (the Search test): holdUntilReleased too, so CI never calls
//     BoardGameGeek.
const IMPORT_PATH = /\/user-games\/user\/[^/]+\/import-bgg-collection$/;
const SEARCH_PATH = /\/games\/bgg\/search$/;

// Review #220: records, for every text mutation of the import outcome region, whether the region
// sat under an aria-hidden ancestor at that moment. The closing import dialog keeps the rest of the
// page aria-hidden until its content unmounts (after its exit animation), and a text change inside
// a hidden subtree is never announced, so a `true` entry is the defect.
async function recordRegionMutations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const region = document.getElementById('bgg-import-status');
    if (!region) throw new Error('#bgg-import-status is not in the document');
    const seen: boolean[] = [];
    (window as unknown as { __bggRegionHidden: boolean[] }).__bggRegionHidden = seen;
    new MutationObserver((records) => {
      for (let i = 0; i < records.length; i += 1) {
        seen.push(region.closest('[aria-hidden="true"]') !== null);
      }
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}

async function regionMutations(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { __bggRegionHidden: boolean[] }).__bggRegionHidden);
}

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test.describe('Profile BGG import and search in flight (plan 88.6.1-60)', () => {
  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Import Collection keeps focus through its dialog and refuses a second press and a second Continue', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const imp = await holdUntilReleased(page, 'POST', IMPORT_PATH);
    await page.goto('/userProfile');

    const field = page.getByRole('textbox', { name: 'BoardGameGeek username' });
    // A missing control is a failure, never a skip.
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill('e2e-meeple');

    // Requirement 8: the outcome region is mounted, polite and empty before the first import.
    const region = page.locator('#bgg-import-status');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveText('');

    // One locator for both labels of the one control, so it follows the label flip.
    const importBtn = page.getByRole('button', { name: /^(Import Collection|Importing\.\.\.)$/ });
    await focusByKeyboard(page, importBtn);
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await recordRegionMutations(page);
    await focusByKeyboard(page, dialog.getByRole('button', { name: 'Continue' }));
    // The double-activation arm: a second Enter during the dialog's exit.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await imp.arrived;
    // A positive wait for the dialog to go, so the exit window has passed.
    await expect(dialog).toHaveCount(0);
    expect(imp.count()).toBe(1);
    await expect(region).toContainText('Fetching your BGG collection...');

    // The dialog's close restore landed on its opener, which is gated but focusable (D-35).
    await expect(importBtn).toBeFocused();
    await expect(importBtn).toHaveAttribute('aria-disabled', 'true');
    await expect(importBtn).not.toHaveAttribute('disabled');
    await expect(importBtn).toHaveText('Importing...');
    await expectGatedPair(page, importBtn, 'primary', 'dark');

    // A press mid-import neither reopens the dialog nor sends a second import.
    await page.keyboard.press('Enter');
    await twoFrames(page);
    await expect(dialog).toHaveCount(0);
    expect(imp.count()).toBe(1);

    await imp.release({ imported: 2, skipped: 1, total: 3 });
    await expect(importBtn).toHaveText('Import Collection');
    await expect(importBtn).not.toHaveAttribute('aria-disabled');
    await expect(importBtn).toBeFocused();

    // The result on the same region, now the visible box, at today's 16px (look unchanged).
    await expect(region).toContainText('Imported 2 games');
    await expect(region).toBeVisible();
    await expect(region.locator('p').first()).toHaveCSS('font-size', '16px');

    // Review #220: the region changed, and never while the closing dialog hid the page.
    const hiddenFlags = await regionMutations(page);
    expect(hiddenFlags.length, 'the outcome region never changed').toBeGreaterThan(0);
    expect(hiddenFlags.filter(Boolean), 'a write landed while the page was aria-hidden').toEqual([]);

    // Requirement 5 (the owner's design of 2026-10-05): the 5-second result timer still empties
    // the username, and focus still on Import Collection moves first to + Add from BGG, never to
    // the body. A positive wait for the timer: the region is emptied and hidden again.
    await expect(region).toHaveClass(/(^|\s)sr-only(\s|$)/, { timeout: 10_000 });
    const toggle = page.getByRole('button', { name: /^(\+ Add from BGG|Hide Search)$/ });
    await expect(toggle).toBeFocused();
    await expect(field).toHaveValue('');
    await expect(importBtn).toBeDisabled();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow around the import block').toBe(true);
    expect(imp.count()).toBe(1);
  });

  test('the import result timer keeps a newly typed name and leaves focus where the user put it', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const imp = await holdUntilReleased(page, 'POST', IMPORT_PATH);
    await page.goto('/userProfile');

    const field = page.getByRole('textbox', { name: 'BoardGameGeek username' });
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill('e2e-meeple');
    const region = page.locator('#bgg-import-status');
    const importBtn = page.getByRole('button', { name: /^(Import Collection|Importing\.\.\.)$/ });
    await focusByKeyboard(page, importBtn);
    await page.keyboard.press('Enter');
    await focusByKeyboard(page, page.getByRole('dialog').getByRole('button', { name: 'Continue' }));
    await page.keyboard.press('Enter');
    await imp.arrived;
    await imp.release({ imported: 2, skipped: 1, total: 3 });
    await expect(region).toContainText('Imported 2 games');

    // Inside the 5-second window the user moves to the field and types another name.
    await focusByKeyboard(page, field);
    await field.fill('e2e-meeple-two');
    await expect(field).toBeFocused();

    // The result line goes on schedule; the typed name and the user's focus stay.
    await expect(region).toHaveClass(/(^|\s)sr-only(\s|$)/, { timeout: 10_000 });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('e2e-meeple-two');
    await expect(importBtn).toBeEnabled();
    await expect(page.getByRole('button', { name: /^(\+ Add from BGG|Hide Search)$/ })).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow around the import block').toBe(true);
    expect(imp.count()).toBe(1);
  });

  test('the import result timer keeps the name while the import dialog is open', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const imp = await holdUntilReleased(page, 'POST', IMPORT_PATH);
    await page.goto('/userProfile');

    const field = page.getByRole('textbox', { name: 'BoardGameGeek username' });
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill('e2e-meeple');
    const region = page.locator('#bgg-import-status');
    const importBtn = page.getByRole('button', { name: /^(Import Collection|Importing\.\.\.)$/ });
    const dialog = page.getByRole('dialog');
    await focusByKeyboard(page, importBtn);
    await page.keyboard.press('Enter');
    await focusByKeyboard(page, dialog.getByRole('button', { name: 'Continue' }));
    await page.keyboard.press('Enter');
    await imp.arrived;
    await imp.release({ imported: 2, skipped: 1, total: 3 });
    await expect(region).toContainText('Imported 2 games');

    // Inside the window: Import Collection again, so the dialog is open when the timer runs.
    await focusByKeyboard(page, importBtn);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();

    // The result line went behind the dialog; the dialog still names the user.
    await expect(region).toHaveClass(/(^|\s)sr-only(\s|$)/, { timeout: 10_000 });
    await expect(dialog).toContainText('e2e-meeple');

    // Cancel: the name stays, and the close restore lands on an ENABLED Import Collection.
    await focusByKeyboard(page, dialog.getByRole('button', { name: 'Cancel' }));
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(field).toHaveValue('e2e-meeple');
    await expect(importBtn).toBeEnabled();
    await expect(importBtn).toBeFocused();

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow around the import block').toBe(true);
    // Continue is pinned in the unit suite (T3-D); no second import is sent here.
    expect(imp.count()).toBe(1);
  });

  test('the import outcome is written only after the dialog has gone, on a fast failure too', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const imp = await holdUntilReleased(page, 'POST', IMPORT_PATH);
    await page.goto('/userProfile');

    const field = page.getByRole('textbox', { name: 'BoardGameGeek username' });
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill('e2e-meeple');

    const region = page.locator('#bgg-import-status');
    const importBtn = page.getByRole('button', { name: /^(Import Collection|Importing\.\.\.)$/ });
    await focusByKeyboard(page, importBtn);
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await recordRegionMutations(page);
    await focusByKeyboard(page, dialog.getByRole('button', { name: 'Continue' }));
    await page.keyboard.press('Enter');

    // Answered AT ONCE with a 500, so the failure settles inside the dialog's exit window.
    await imp.arrived;
    await imp.release({ error: 'e2e import failure' }, 500);

    await expect(dialog).toHaveCount(0);
    await expect(region).toHaveClass(/(^|\s)bg-status-error-subtle(\s|$)/);
    await expect(region).not.toHaveClass(/(^|\s)sr-only(\s|$)/);
    await expect(region).not.toHaveText('');
    await expect(region).toBeVisible();

    const hiddenFlags = await regionMutations(page);
    expect(hiddenFlags.length, 'the outcome region never changed').toBeGreaterThan(0);
    expect(hiddenFlags.filter(Boolean), 'a write landed while the page was aria-hidden').toEqual([]);

    await expect(importBtn).toHaveText('Import Collection');
    await expect(importBtn).not.toHaveAttribute('aria-disabled');
    expect(imp.count()).toBe(1);

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow around the import failure').toBe(true);
  });

  test("Search keeps focus and refuses a second press and the field's Enter", async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const s = await holdUntilReleased(page, 'GET', SEARCH_PATH);
    await page.goto('/userProfile');

    const toggle = page.getByRole('button', { name: '+ Add from BGG' });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    const field = page.getByRole('textbox', { name: 'Search BoardGameGeek' });
    await field.fill('catan');

    const search = page.getByRole('button', { name: /^(Search|Searching\.\.\.)$/ });
    await focusByKeyboard(page, search);
    await page.keyboard.press('Enter');
    await s.arrived;

    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-disabled', 'true');
    await expect(search).not.toHaveAttribute('disabled');
    await expect(search).toHaveText('Searching...');
    await expectGatedPair(page, search, 'primary', 'dark');

    // A second press is refused...
    await page.keyboard.press('Enter');
    expect(s.count()).toBe(1);
    // ...and so is the field's own Enter, the second entry point.
    await field.focus();
    await page.keyboard.press('Enter');
    await twoFrames(page);
    expect(s.count()).toBe(1);

    await s.release([{ bgg_id: 990001, name: 'E2E Meeple Game', year_published: 2001 }]);
    await expect(page.getByText('E2E Meeple Game (2001)')).toBeVisible();
    await expect(search).toHaveText('Search');
    await expect(search).not.toHaveAttribute('aria-disabled');
    // Add to Collection is deliberately never pressed.

    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow around the search panel').toBe(true);
    expect(s.count()).toBe(1);
  });
});

// Phase 88.6.1 plan 61 (Req 11, owner ruling 2026-10-05): when the account lookup fails with no
// row, the Notification Preferences card is HIDDEN rather than filled with the app's defaults, and
// the hidden card leaves no hole in the card rhythm. After Retry the row arrives and the card
// appears with the user's own settings, and a toggle sends those settings plus the one change.
// The jsdom cases (page.test.tsx, `identity row kept or late (88.6.1-61: Req 11, AC-29)`) pin the
// page's half; this proves the Retry path and the layout in a real browser at 375px.
//
// Trigger A (a refetch that fails over a kept row) is NOT scripted here: reaching it in a browser
// runs through EmailAddressSection's internal failure arms, which another plan restructures; its
// library half is pinned by `src/lib/hooks/useSelfIdentity.retainedOnError.test.tsx`.
//
// Fixture-account protection (T-88.6.1-1225): `holdWrites` is registered FIRST, so the
// notification PATCH is held in the browser and never sent; the test asserts it is the only
// held request. This describe has no `expectNoApiWrites` afterEach because the one held PATCH is
// the point of the test.
const REAL_PREFS = {
  event_created: { email: true, sms: false },
  reminder: { email: true, sms: false, window_hours: 24 },
  event_updated: { email: false, sms: false },
  event_cancelled: { email: true, sms: false },
};

test.describe('Profile account lookup failure and the notification card (plan 88.6.1-61)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test("with no account row the notification card is hidden, and after Retry it shows the user's own settings", async ({ page }, testInfo) => {
    const hold = await holdWrites(page);
    let failing = true;
    await patchSelfRow(
      page,
      { username: 'E2E Real Name', notification_preferences: REAL_PREFS },
      { failWhile: () => failing },
    );
    await page.goto('/userProfile');

    // A missing control is a failure, never a skip.
    const retry = page.getByRole('button', { name: /^Retry/ }).first();
    await expect(retry).toBeVisible({ timeout: 15_000 });

    // No card: no heading, no switch.
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);

    // No hole: Theme -> Timezone and Timezone -> Availability Settings keep the same gap.
    const cardWith = (name: string) =>
      page.locator('div.card').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) }).last();
    const availability = page.locator('#availability-settings');
    await settleAnimations(page.locator('main'));
    const theme = await cardWith('Theme').boundingBox();
    const timezone = await cardWith('Timezone').boundingBox();
    const avail = await availability.boundingBox();
    expect(theme && timezone && avail, 'the three cards render').toBeTruthy();
    if (theme && timezone && avail) {
      const above = timezone.y - (theme.y + theme.height);
      const below = avail.y - (timezone.y + timezone.height);
      expect(Math.abs(above - below), `card gaps ${above}px and ${below}px`).toBeLessThanOrEqual(1);
    }
    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    let fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow with the card hidden').toBe(true);

    // The lookup recovers; Retry brings the row, and the card appears with the user's settings.
    failing = false;
    await retry.click();
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('switch', { name: 'Event Updates email notifications' })).toHaveAttribute(
      'aria-checked',
      'false',
      { timeout: 15_000 },
    );
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Real Name' })).toBeVisible({ timeout: 15_000 });

    // A toggle sends the real settings plus the one change (held, never sent).
    const patch = page.waitForRequest(
      (request) => request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/notification-preferences'),
    );
    await page.getByRole('switch', { name: 'New Event email notifications' }).click();
    const request = await patch;
    expect(request.postDataJSON()).toEqual({
      preferences: { ...REAL_PREFS, event_created: { email: false, sms: false } },
    });

    expect(hold.count('PATCH', /\/notification-preferences$/)).toBe(1);
    // The house rule (expectNoApiWrites): a non-/api request (a telemetry beacon) may be held too
    // and is not a write to the backend, so "nothing else" is read over /api writes.
    const apiWrites = hold.held.filter((held) => new URL(held.url).pathname.startsWith('/api/'));
    expect(apiWrites, 'only the notification PATCH was held').toHaveLength(1);
    fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow with the card shown').toBe(true);
  });
});

// Phase 88.6.1 plan 67 (Requirement 9, copy row P8; Requirement 5): the game collection. Every
// owned-games read below is answered in the browser by the shared release-capable hold (a later
// registration takes precedence for the same request), behind plan 43's holdWrites net, so no read
// of the fixture account's real list decides a test and no write reaches the backend.
const OWNED_GAMES_PATH = /\/user-games\/user\/[^/]+$/;
const ONE = { id: 'e2e-game-one', name: 'E2E Meeple One', bgg_id: 990101, year_published: 2001, image_url: null };
const TWO = { id: 'e2e-game-two', name: 'E2E Meeple Two', bgg_id: 990102, year_published: 2002, image_url: null };
// Copy row P8 (owner-ratified 2026-10-05), straight apostrophe.
const COLLECTION_P8 = "Couldn't load your collection";

function collectionCard(page: Page) {
  return page.locator('div.card').filter({ has: page.getByRole('heading', { level: 2, name: /^My Game Collection/ }) });
}

test.describe('Profile game collection (plan 88.6.1-67)', () => {
  let backstop: WriteHold | undefined;

  test.afterEach(async ({ page }) => {
    expectNoApiWrites(backstop);
    backstop = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a failed first collection load shows the banner, and Try again brings the games back', async ({ page }, testInfo) => {
    backstop = await holdWrites(page);
    const first = await holdUntilReleased(page, 'GET', OWNED_GAMES_PATH);
    await page.goto('/userProfile');
    await first.arrived;
    await first.release({ error: 'boom' }, 500);

    const collection = collectionCard(page);
    const heading = collection.getByRole('heading', { level: 2, name: /^My Game Collection/ });
    const banner = collection.getByText(COLLECTION_P8).first();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(collection.getByText(/You don't have any games in your collection yet/)).toHaveCount(0);
    await expect(heading).toContainText('—');
    await expect(heading).not.toContainText('(0)');
    const cardBox = await collection.boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(cardBox && bannerBox, 'card and banner have boxes').toBeTruthy();
    if (cardBox && bannerBox) {
      expect(bannerBox.x, 'banner left edge').toBeGreaterThanOrEqual(cardBox.x);
      expect(bannerBox.x + bannerBox.width, 'banner right edge').toBeLessThanOrEqual(cardBox.x + cardBox.width);
    }
    if (testInfo.project.name === 'phone') {
      expect(page.viewportSize()?.width).toBe(375);
    }
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'horizontal overflow with the collection banner showing').toBe(true);

    // The retry's read, held: the banner stays through it (the error is kept, C2), no loader.
    const second = await holdUntilReleased(page, 'GET', OWNED_GAMES_PATH);
    await collection.getByRole('button', { name: /^(Try again|Retrying…)$/ }).click();
    await second.arrived;
    await expect(banner).toBeVisible();
    await expect(collection.getByText('Loading your collection...')).toHaveCount(0);

    await second.release([ONE]);
    await expect(collection.getByRole('button', { name: 'Remove E2E Meeple One' })).toBeVisible({ timeout: 15_000 });
    await expect(collection.getByText(COLLECTION_P8)).toHaveCount(0);
    const loaded = collection.getByRole('heading', { level: 2, name: 'My Game Collection (1)' });
    await expect(loaded).toBeVisible();
    await expect(loaded).toBeFocused();
  });
});
