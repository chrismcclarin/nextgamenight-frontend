import { test, expect, type Request } from '@playwright/test';

// Phase 88.6.1 plan 25 (Requirement 1) — an event link opened SIGNED OUT, at phone width.
//
// D-40's automated arm for AC-1: before this plan, a signed-out event link (the owner's own SMS
// path, 2026-07-16) landed on "Event not found / This event no longer exists or has been
// cancelled." This file proves, in a real browser, that the page now goes straight to sign-in with
// the event as the return address, exactly once, and that coming back without signing in shows
// the banner instead of redirecting again (AC-2). The second half MEASURES RESEARCH MC-6 in
// Chromium: the per-event sessionStorage latch survives the same-tab round trip through Auth0's
// origin. If it ever did not, the page would loop, and that is a STOP for the owner.
//
// How it runs:
// - SIGNED OUT: storageState is overridden to an empty one (the contrast.spec.ts OI-7 idiom), so
//   the BFF proxy forwards the event fetch with no token and the backend answers 401.
// - PHONE ONLY: both app projects match every spec, so the desktop journeys project is skipped
//   (the restore-preview.spec.ts idiom). The phone project is the iPhone SE preset, 375 x 667.
// - CI ONLY: there is no local `.auth`, and the Auth0 tenant and the seeded event are CI's.
// - This spec never types a credential (the setup project's no-capture rule, DECISION Phase 88.6
//   CR-01 / R2-H5 in playwright.config.ts).
// - Owner check A (a real text message on his phone, then a real sign-in) is post-merge and is
//   NOT replaced by this file (D-40; recorded by plan 88.6.1-58).

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI. Same variable names and
// the same obviously-fake fallback as contrast.spec.ts: the fallback id fails the page's UUID guard,
// so a missing fixture fails loudly at the first assertion instead of passing on the wrong screen.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const EVENT_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

test.describe('Phase 88.6.1-25 — a signed-out event link at phone width (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Requirement 1 phone arm — phone project only');
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a signed-out event link goes straight to sign-in with the event as returnTo, and coming back does not redirect again (D-40, AC-1, AC-2)', async ({
    page,
  }) => {
    const loginRequests: string[] = [];
    page.on('request', (req: Request) => {
      if (new URL(req.url()).pathname === '/api/auth/login') loginRequests.push(req.url());
    });

    // `commit`: the client-side replace can interrupt a full load.
    await page.goto(EVENT_PATH, { waitUntil: 'commit' });
    await page.waitForURL(/\/u\/login|auth0\.com/, { timeout: 15_000 }).catch(() => {
      throw new Error(`Never reached Auth0 Universal Login — browser is at: ${page.url()}`);
    });

    expect(loginRequests, 'exactly one sign-in request').toHaveLength(1);
    const returnTo = new URL(loginRequests[0]).searchParams.get('returnTo');
    expect(returnTo, 'the return address is the event path, built from the page location').toBe(
      EVENT_PATH
    );

    // Back to the event in the SAME tab without signing in: the latch is still set, so the 401 now
    // renders the banner and makes no second sign-in request (AC-2; MC-6 measured).
    await page.goto(EVENT_PATH);
    await expect(page.getByText("We couldn't load this event")).toBeVisible();
    expect(loginRequests, 'no second sign-in request after the round trip').toHaveLength(1);
  });
});
