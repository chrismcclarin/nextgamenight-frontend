import { test, expect, type Page } from '@playwright/test';

// Phase 88.6.1 plan 14 (D-28, copy row H4): a FAILED suggestions load, seen on a phone.
//
// WHY THIS FILE EXISTS. Before 88.6.1-14 a failed group-suggestions fetch rendered the
// empty-collection hint ("Add games to your collection to enable suggestions") — a sentence the
// app does not know to be true. The slot now shows the H4 line in the hint's own box. The jsdom
// suite (`src/app/components/QuickSuggestions.test.tsx`, arms Q1-Q6) proves the content and the
// structure; jsdom evaluates no layout, so THIS spec is where the geometry is proven at the
// phone project's 375 x 667: the line sits inside the one fixed-height slot (its 44px floor, no
// wrap growth), does not overflow its box, does not run past the viewport, and the slot holds no
// live-region semantics (D-09b: the failed line is not announced).
//
// CI ONLY. The phone and journeys projects need the `.auth/user.json` login state, which exists
// only in CI (C-14 in .planning/codebase/FE-TESTING-CONVENTIONS.md). It was not run locally.
//
// SYNTHETIC FAILURE, NO REAL DATA. The route answers the browser's suggestions request with a
// 500 and a small made-up error body; nothing is forwarded to the backend and nothing is
// written. The Create Event form is never submitted.

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';
const FIXTURE_OWNER = 'periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js';

// Repo idiom (e2e/event-scheduler-touch.spec.ts, the file-scope E2E_GROUP_ID guard): assert,
// name the var and its producer, never echo the value.
test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this file opens Create Event for a group the fixtures do not own.',
  ).toBeTruthy();
});

// The browser calls the BFF (`BFF_BASE` is `/api` in src/lib/api.ts), so the suggestions request
// is `/api/suggestions/group/<id>?...`.
const SUGGESTIONS_REQUEST = /\/api\/suggestions\/group\//;

// Copy row H4, byte-equal to the component's constant (straight apostrophe, D-32 R8).
const H4_FAILED_LINE = "We couldn't load suggestions.";
const EMPTY_HINT = 'Add games to your collection to enable suggestions';

const dialog = (page: Page) => page.getByRole('dialog');

test('a failed suggestions load shows the H4 line inside the 44px slot (88.6.1-14, D-28)', async ({ page }) => {
  await page.route(SUGGESTIONS_REQUEST, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'synthetic failure (88.6.1-14 e2e)' }),
    });
  });
  const suggestionsRequest = page.waitForRequest(SUGGESTIONS_REQUEST);

  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

  // The participant list is auto-filled with the group's members, so the participant count
  // reaches 1 and the fetch fires after its 500ms debounce. If it never fires, the fixture group
  // has no members — a fixture failure, not a pass.
  try {
    await suggestionsRequest;
  } catch {
    throw new Error(
      `the group-suggestions request never fired — the fixture group needs at least one member for the participant count to reach 1 (owner: ${FIXTURE_OWNER})`,
    );
  }

  const slot = dialog(page).getByTestId('quick-suggestions-slot');
  await expect(slot).toHaveCount(1);
  const failedBox = slot.getByTestId('quick-suggestions-failed');
  await expect(failedBox).toHaveText(H4_FAILED_LINE);
  await expect(slot.getByText(EMPTY_HINT)).toHaveCount(0);
  await expect(slot.locator('[role="alert"], [role="status"], [aria-live]')).toHaveCount(0);

  // The slot's floor is min-h-11 (44px); a wrapped line would grow it.
  const slotBox = await slot.boundingBox();
  expect(slotBox, 'the quick-suggestions slot has no layout box').not.toBeNull();
  expect(slotBox!.height).toBeGreaterThanOrEqual(44);
  expect(slotBox!.height).toBeLessThanOrEqual(45);

  const fitsItsBox = await failedBox
    .locator('p')
    .evaluate((p) => p.scrollWidth <= p.clientWidth);
  expect(fitsItsBox, 'the H4 line overflows its paragraph box at 375px').toBe(true);

  const viewport = page.viewportSize();
  expect(viewport, 'the page has no viewport size').not.toBeNull();
  const failedBoxRect = await failedBox.boundingBox();
  expect(failedBoxRect, 'the failed box has no layout box').not.toBeNull();
  expect(failedBoxRect!.x + failedBoxRect!.width).toBeLessThanOrEqual(viewport!.width);
});
