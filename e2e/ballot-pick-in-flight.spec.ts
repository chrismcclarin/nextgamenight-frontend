import { test, expect, type Page, type Route } from '@playwright/test';

import { holdWrites, type WriteHold } from './support/inFlight';

// Phase 88.6.1 plan 31 — the Game Vote at 375px, in a real browser.
//
// WHAT IT PROVES (what jsdom cannot):
//   A (W013, E14, Req 5): a tie-break pick pressed by keyboard keeps focus while it saves, carries
//     aria-disabled with no native disabling attribute, is named "{game}, saving", a second Enter
//     sends nothing, and after the save focus lands on the winner card (never the page body).
//   B (E13): a pick that fails shows the ratified failure line in full inside the 375px viewport,
//     with no sideways scroll, and the pick keeps focus.
//   C (E15, Req 9, Req 5): a failed load shows the "Couldn't load the game vote" banner inside the
//     viewport with no backend text, and its Try again loads the vote with focus on the
//     "Game Vote" heading (plan 88.6.1-70's focusTarget), not the top of the page.
//   D (E15's other half): the server's own no-vote answer shows no banner and no card.
// The RED half of every one of these lives in jsdom (src/app/components/BallotSection.test.tsx,
// T1a-T1h, T2a-T2i, NB-1, LF-1..LF-10); this spec is the phone-width proof.
//
// IT NEVER WRITES TO THE BACKEND. The ballot GET and the resolve-tie POST are fulfilled with
// page.route on their BROWSER paths (apiFetch prefixes every endpoint with /api: src/lib/api.ts,
// anchor `const BFF_BASE = '/api';`), so the shared fixture event's ballot is never read for real
// and never written. Behind the two mocks sits the shared write hold (e2e/support/inFlight.ts,
// holdWrites), registered FIRST so it runs LAST (Playwright runs the newest matching handler
// first; route.fallback() hands on to older ones): any other write is held in the browser,
// never sent, and the afterEach fails the test naming every /api write it caught. A mock that
// declines a request uses route.fallback(), never route.continue(), so the hold still sees it.
//
// DECISION Phase 88.6.1-31 (e2e option names): the mocked ballot's options are "E2E Catan" and
// "E2E Wingspan", chosen OVER the plan's bare "Catan" and "Wingspan": the seed holds real games
// with those two names (periodictabletopbackend_v2/Sonnet/scripts/seed-sample-data.js, anchors
// `name: 'Catan',` and `name: 'Wingspan',`), so a text locator for the bare name could match a
// second button on the event page and fail on strict mode. Changing this is a decision, not a
// cleanup.
//
// CI ONLY: the phone project needs .auth/user.json and the E2E login secrets, which exist only
// in CI (FE-TESTING-CONVENTIONS C-14). Locators are role, name and text only. No screenshots.

// Seeded fixture ids, the same env-with-fallback idiom as padding-budget.spec.ts. The event is
// Weekend Warriors' (periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js, anchor
// `const eventDetailPath =`), which the signed-in fixture user owns, so the picks render.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

// Copy rows, written once here: E13 and E15 (D-30, straight apostrophe per D-32 R8).
const E13 = "We couldn't set the winner. Please try again.";
const E15 = "Couldn't load the game vote";
const TIE_PROMPT = 'Voting ended in a tie! Pick the winning game:';

const CATAN = 'E2E Catan';
const WINGSPAN = 'E2E Wingspan';
const CATAN_GAME_ID = '00000000-0000-4000-8000-0000000003a1';
const OPTIONS = [
  { id: '00000000-0000-4000-8000-0000000003b1', game_id: CATAN_GAME_ID, game_name: CATAN, user_voted: false },
  { id: '00000000-0000-4000-8000-0000000003b2', game_id: '00000000-0000-4000-8000-0000000003a2', game_name: WINGSPAN, user_voted: false },
];
const TIE_BALLOT = {
  ballot_status: 'closed',
  rsvp_deadline: null,
  options: OPTIONS,
  winner: null,
  needs_tie_break: true,
  needs_fallback_pick: false,
  tied_options: OPTIONS,
};
const WINNER_BALLOT = {
  ...TIE_BALLOT,
  winner: { game_id: CATAN_GAME_ID, game_name: CATAN },
  needs_tie_break: false,
  needs_fallback_pick: false,
  tied_options: null,
};
// The server's exact no-vote body (periodictabletopbackend_v2/Sonnet/routes/ballot.js, anchor
// `return res.json({ ballot_status: null });`).
const NO_VOTE_BODY = { ballot_status: null };

const FIXTURE_MISS =
  'the tie-break picks never rendered: the fixture event from ' +
  'periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js must load, and the signed-in fixture ' +
  'user must hold the organizer (owner or admin) role on its group';

// The ballot GET is /api/ballot/<eventId>; its writes are /vote, /resolve-tie and /options.
const isBallotRead = (url: URL) => /^\/api\/ballot\/[^/]+$/.test(url.pathname);
const isResolveTie = (url: URL) => /^\/api\/ballot\/[^/]+\/resolve-tie$/.test(url.pathname);

// Answers every ballot GET with whatever `answer()` returns at the time, and counts them.
async function mockBallotRead(page: Page, answer: () => { status: number; json: unknown }) {
  const reads = { count: 0 };
  await page.route(isBallotRead, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    reads.count += 1;
    const { status, json } = answer();
    await route.fulfill({ status, json });
  });
  return reads;
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function expectInsideViewport(page: Page, name: string, box: { x: number; width: number } | null) {
  const viewport = page.viewportSize();
  expect(box, `${name} has a layout box`).not.toBeNull();
  expect(viewport, 'the phone project has a viewport').not.toBeNull();
  expect(box!.x, `${name} starts inside the viewport (x >= 0)`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} ends inside the ${viewport!.width}px viewport`).toBeLessThanOrEqual(
    viewport!.width,
  );
}

test.describe('the Game Vote at 375px: one pick per press, focus after it, and a failed load that says so (88.6.1-31)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet check — phone project only');

  let hold: WriteHold;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any mock and before navigation, so it is the last resort.
    hold = await holdWrites(page);
  });

  // A late ballot read or a held resolve-tie handler must never fail a test after its last
  // assertion (plan 88.6.1-42's wave-5 gate fix, manage-members-refresh.spec.ts).
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test.afterEach(() => {
    const apiWrites = hold.held.filter((request) => new URL(request.url).pathname.startsWith('/api/'));
    expect(apiWrites, 'an /api write reached the backstop: mock that exact path in this spec').toEqual([]);
  });

  test('A: tie-break pick at 375 — the pressed pick keeps focus while it saves, a second Enter sends nothing, and focus lands on the winner', async ({ page }) => {
    const state = { decided: false };
    await mockBallotRead(page, () => ({ status: 200, json: state.decided ? WINNER_BALLOT : TIE_BALLOT }));
    const posts = { count: 0 };
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(isResolveTie, async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      posts.count += 1;
      await released;
      state.decided = true;
      await route.fulfill({ status: 200, json: { winner: { game_id: CATAN_GAME_ID, game_name: CATAN } } });
    });

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await expect(page.getByText(TIE_PROMPT), FIXTURE_MISS).toBeVisible({ timeout: 15_000 });

    // Located by VISIBLE text: the accessible name changes while the pick saves.
    const catan = page.locator('button', { hasText: CATAN });
    const wingspan = page.locator('button', { hasText: WINGSPAN });

    await catan.focus();
    await page.keyboard.press('Enter');

    await expect(catan, 'the pressed pick keeps focus while it saves').toBeFocused();
    await expect(catan, 'the pressed pick is aria-disabled while it saves').toHaveAttribute('aria-disabled', 'true');
    await expect(catan, 'the pressed pick carries no native disabling attribute').not.toHaveAttribute('disabled');
    await expect(
      page.getByRole('button', { name: `${CATAN}, saving` }),
      'the pressed pick is named "{game}, saving" while it saves (E14)',
    ).toBeVisible();
    await expect(wingspan, 'the sibling pick is natively disabled while the pressed one saves').toBeDisabled();
    expect(await noHorizontalOverflow(page), 'no horizontal overflow at 375px while saving').toBe(true);

    // A second Enter on the saving pick. Absence is bounded by a short settle on purpose: the
    // exact one-request rule is pinned in jsdom (T1a, T1c); this checks it in a real browser.
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(posts.count, 'a second Enter on the saving pick sends no second resolve-tie').toBe(1);

    release();
    await expect(page.getByText('Winner', { exact: true }), 'the winner card renders after the save').toBeVisible();
    await expect(page.locator(':focus'), 'focus lands on the winner card, which reads Winner').toContainText('Winner');
    await expect(page.locator(':focus'), 'focus lands on the winner card, which names the game').toContainText(CATAN);
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
      'focus is never left on the page body after the pick',
    ).toBe(true);
  });

  test('B: tie-break pick failure at 375 — the ratified line shows in full and the pick keeps focus', async ({ page }) => {
    await mockBallotRead(page, () => ({ status: 200, json: TIE_BALLOT }));
    await page.route(isResolveTie, async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { error: 'e2e mock failure' } });
    });

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await expect(page.getByText(TIE_PROMPT), FIXTURE_MISS).toBeVisible({ timeout: 15_000 });

    const catan = page.locator('button', { hasText: CATAN });
    await catan.focus();
    await page.keyboard.press('Enter');

    const line = page.getByText(E13);
    await expect(line, 'the ratified E13 line shows after the failed pick').toBeVisible();
    await expectInsideViewport(page, 'the E13 line', await line.boundingBox());
    expect(await noHorizontalOverflow(page), 'no horizontal overflow at 375px with E13 shown').toBe(true);
    await expect(page.getByText('e2e mock failure'), 'no backend text reaches the page').toHaveCount(0);
    await expect(catan, 'the pick keeps focus after the failure').toBeFocused();
    await expect(catan, 'the pick is back at rest after the failure').not.toHaveAttribute('aria-disabled');
  });

  test('C: load failure at 375 — the game vote says it could not load, shows no backend text, and Try again brings it back', async ({ page }) => {
    // A flag, not "the first GET", so the test does not depend on how many loads the page starts.
    const state = { loadRecovers: false };
    const reads = await mockBallotRead(page, () =>
      state.loadRecovers
        ? { status: 200, json: TIE_BALLOT }
        : { status: 500, json: { error: 'e2e mock failure' } },
    );

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await expect(page.getByText(E15), 'a failed ballot load shows the E15 banner').toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('e2e mock failure'), 'no backend text reaches the page').toHaveCount(0);
    await expect(page.getByText('Voting ended in a tie!'), 'no ballot is shown for a failed load').toHaveCount(0);

    const tryAgain = page.getByRole('button', { name: 'Try again' });
    await expect(tryAgain, 'the banner has its own Try again').toBeVisible();
    await expectInsideViewport(page, 'Try again', await tryAgain.boundingBox());
    expect(await noHorizontalOverflow(page), 'no horizontal overflow at 375px with the banner shown').toBe(true);

    const readsBefore = reads.count;
    state.loadRecovers = true;
    await tryAgain.click();

    await expect(page.getByText(TIE_PROMPT), 'Try again loads the vote').toBeVisible();
    await expect(page.getByText(E15), 'the banner leaves once the vote loads').toHaveCount(0);
    expect(reads.count, 'Try again sends exactly one ballot read').toBe(readsBefore + 1);
    const heading = page.getByRole('heading', { name: 'Game Vote' });
    await expect(heading, 'focus lands on the Game Vote heading, not the top of the page').toBeFocused();
    await expectInsideViewport(page, 'the Game Vote heading', await heading.boundingBox());
  });

  test('D: no vote at 375 — an event with no vote shows no banner and no card', async ({ page }) => {
    const reads = await mockBallotRead(page, () => ({ status: 200, json: NO_VOTE_BODY }));

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await expect
      .poll(() => reads.count, { message: 'the ballot section asked for the ballot', timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
    await expect(page.getByText('Loading ballot...'), 'the ballot load has settled').toHaveCount(0);

    await expect(page.getByText(E15), 'the no-vote answer shows no load-failure banner').toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Game Vote' }), 'the no-vote answer shows no card').toHaveCount(0);
    await expect(page.getByText('Voting ended in a tie!'), 'the no-vote answer shows no picks').toHaveCount(0);
  });
});
