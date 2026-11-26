import { test, expect, type Page } from '@playwright/test';

import { settleAnimations } from './support/inFlight';

// Phase 88.6.1 plan 14 (D-28, copy row H4): a FAILED suggestions load, seen on a phone.
//
// WHY THIS FILE EXISTS. Before 88.6.1-14 a failed group-suggestions fetch rendered the
// empty-collection hint ("Add games to your collection to enable suggestions") — a sentence the
// app does not know to be true. The slot now shows the H4 line in the hint's own box. The jsdom
// suite (`src/app/components/QuickSuggestions.test.tsx`, arms Q1-Q6) proves the content and the
// structure; jsdom evaluates no layout, so THIS spec is where the geometry is proven at the
// phone project's 375 x 667: the line sits inside the one fixed-height slot, does not overflow its
// box, does not run past the viewport, and the slot holds no live-region semantics (D-09b: the
// failed line is not announced).
//
// 88.9 D13c (owner pick): the failed box also carries a Try again link right of the line (44px
// tall), so the failed state's slot is 52px (box 48 + pb-1) while the empty and chip states keep 44.
// (88.9-52 A-08: "link" is the house word for it; the element is a button styled as a link, which
// is why it is located by role button below.)
//
// 88.9-52 (A-20): the last block presses Try again against a HELD answer and proves the busy state
// on the phone: aria-disabled, the heard suffix, the delayed house Spinner, and the same 52px slot
// with nothing wrapped or pushed out of the box.
//
// AMENDED 89.6-18 (A-held, owner ruling 2026-11-26): the suggestions row is two lines tall in EVERY
// state (Browse more has a line of its own under the chips, and the other three states are held at
// that height), so the failed state's slot is no longer 52px: it is the held height, 100px at
// normal text (two 44px rows, the 8px row gap, the 4px foot), with the 48px failed box inside it.
// The second test reads all four states at 375 and 320 and finds one height. The marker is at
// src/app/components/QuickSuggestions.js ("AMENDED Phase 89.6-18 (A-held)").
//
// CI ONLY. The phone and journeys projects need the `.auth/user.json` login state, which exists
// only in CI (C-14 in .planning/codebase/FE-TESTING-CONVENTIONS.md). It was not run locally.
//
// SYNTHETIC FAILURE, NO REAL DATA. The route answers the browser's suggestions request with a
// 500 and a small made-up error body; nothing is forwarded to the backend and nothing is
// written. The Create Event form is never submitted.
//
// AMENDED 89.6-18 (R17, 2026-11-26): EVERY GEOMETRY READ WAITS FOR THE DIALOG TO STOP MOVING.
// The house dialog opens over 200ms, sliding down from 48% of its own height and growing from 95%,
// src/components/ui/dialog.tsx ("data-[state=open]:slide-in-from-top-[48%]"), and boundingBox()
// reads the box as it is drawn at that moment. In CI (production build, backend on the same
// machine) the member read answers inside those 200ms, so the form and the in-flight bar are on
// screen while the dialog is still on its way: the second test read the button below the row at
// 267.1, 281.8, 292.0, 298.6 and 302.2 where it rests at 303.35, and called that the form moving
// when the chips arrived (runs 45885350275 and 45890693140; the same read repeated after the
// animations had finished gave 303.3515625 in 8 of 8, with the fonts loaded at every read). Locally
// the member read answers after the animation has ended, so the test passed there. So each test
// waits with the house wait, e2e/support/inFlight.ts ("export async function settleAnimations"),
// before its first geometry read. It waits for the animation to END: no fixed time, no retry and
// no tolerance, and the assertions are unchanged. The first test's reads were shielded only by the
// 500ms debounce before its failed line shows; it takes the same wait.

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

test('a failed suggestions load shows the H4 line and a Try again link-styled button inside the slot (88.6.1-14 D-28; 88.9 D13c)', async ({ page }) => {
  await page.route(SUGGESTIONS_REQUEST, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'synthetic failure (88.6.1-14 e2e)' }),
    });
  });
  const suggestionsRequest = page.waitForRequest(SUGGESTIONS_REQUEST);

  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
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
  // 88.9 D13c: the box now holds the H4 <p> AND the Try again link, so the line is read from the <p>.
  await expect(failedBox.locator('p')).toHaveText(H4_FAILED_LINE);
  const retry = failedBox.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  await expect(slot.getByText(EMPTY_HINT)).toHaveCount(0);
  await expect(slot.locator('[role="alert"], [role="status"], [aria-live]')).toHaveCount(0);

  // 88.9 D13c (owner pick, 88.9-PICKS-B3.json item D13): the failed box grows to hold the 44px link (40 -> 48), the slot with it; the empty and chip states keep 44.
  // The slot is min-h-11 + pb-1: 48 (box) + 4 (pb-1) = 52; a wrapped line would grow it further.
  // AMENDED 89.6-18 (A-held): the 48px box now sits inside the held two-line height, so the slot
  // reads 100 (44 + 8 + 44 + 4) on a failure as in every other state; the box itself is unchanged.
  // R17: the dialog has stopped moving before the first geometry read (the header note).
  await settleAnimations(dialog(page));
  const slotBox = await slot.boundingBox();
  expect(slotBox, 'the quick-suggestions slot has no layout box').not.toBeNull();
  expect(slotBox!.height, 'the failed state is not the held two-line height').toBeGreaterThanOrEqual(100);
  expect(slotBox!.height, 'the failed state is taller than the held two-line height').toBeLessThanOrEqual(101);
  const failedHeight = (await failedBox.boundingBox())?.height ?? 0;
  expect(failedHeight, 'the failed box no longer holds the 44px link (48 with its border)').toBeGreaterThanOrEqual(48);
  expect(failedHeight, 'the failed box grew past its own content').toBeLessThanOrEqual(49);

  // The link clears the 44px floor and sits inside the failed box and the viewport.
  const retryBox = await retry.boundingBox();
  expect(retryBox, 'the Try again link has no layout box').not.toBeNull();
  expect(retryBox!.height).toBeGreaterThanOrEqual(44);

  const fitsItsBox = await failedBox
    .locator('p')
    .evaluate((p) => p.scrollWidth <= p.clientWidth);
  expect(fitsItsBox, 'the H4 line overflows its paragraph box at 375px').toBe(true);

  const viewport = page.viewportSize();
  expect(viewport, 'the page has no viewport size').not.toBeNull();
  const failedBoxRect = await failedBox.boundingBox();
  expect(failedBoxRect, 'the failed box has no layout box').not.toBeNull();
  expect(failedBoxRect!.x + failedBoxRect!.width).toBeLessThanOrEqual(viewport!.width);
  expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(failedBoxRect!.x + failedBoxRect!.width);
  expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(viewport!.width);

  // 88.9-52 (A-20): the busy state. The retry's answer is HELD so the in-flight look can be
  // measured; it is a GET answered with the same synthetic 500, so nothing is written either way.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.unroute(SUGGESTIONS_REQUEST);
  await page.route(SUGGESTIONS_REQUEST, async (route) => {
    await held;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'synthetic failure (88.9-52 e2e)' }),
    });
  });
  const retryRequest = page.waitForRequest(SUGGESTIONS_REQUEST);
  await retry.click();
  // AMENDED 88.9-52 (CI on e2e2331): this exact name found nothing while the suffix was a visually
  // hidden span (Chromium computed "Try again , retrying", a space before the comma, because that
  // span is its own block box). The component now names the busy link with an aria-label, so the
  // exact name is the true one here; it is not loosened to the optional-space pattern other specs
  // use for the span-suffixed house controls.
  const busyRetry = failedBox.getByRole('button', { name: 'Try again, retrying', exact: true });
  await expect(busyRetry).toHaveAttribute('aria-disabled', 'true');
  await retryRequest;
  // The house Spinner appears 200ms into the busy state; the debounce alone is 500ms.
  await expect(busyRetry.locator('[data-slot="spinner"]')).toBeVisible();
  // The Spinner adds nothing to the name, and the visible words are unchanged.
  await expect(busyRetry).toHaveAccessibleName('Try again, retrying');
  await expect(busyRetry).toHaveText('Try again');
  const busySlotBox = await slot.boundingBox();
  expect(busySlotBox, 'the busy slot has no layout box').not.toBeNull();
  // AMENDED 89.6-18 (A-held): the held height, as above (was 52 to 53).
  expect(busySlotBox!.height, 'the busy state must not change the held failed slot').toBeGreaterThanOrEqual(100);
  expect(busySlotBox!.height, 'the busy state must not wrap the line').toBeLessThanOrEqual(101);
  const busyRetryBox = await busyRetry.boundingBox();
  const busyFailedRect = await failedBox.boundingBox();
  expect(busyRetryBox, 'the busy Try again link has no layout box').not.toBeNull();
  expect(busyFailedRect, 'the failed box has no layout box').not.toBeNull();
  expect(busyRetryBox!.height).toBeGreaterThanOrEqual(44);
  expect(busyRetryBox!.x + busyRetryBox!.width).toBeLessThanOrEqual(busyFailedRect!.x + busyFailedRect!.width);
  const busyLineFits = await failedBox.locator('p').evaluate((p) => p.scrollWidth <= p.clientWidth);
  expect(busyLineFits, 'the H4 line overflows its paragraph box while the retry runs').toBe(true);

  release();
  // The retry fails again: the link is live again under its plain name.
  await expect(retry).toBeVisible();
  await expect(retry).not.toHaveAttribute('aria-disabled', 'true');
});

// 89.6-18 A-held (owner ruling 2026-11-26): the suggestions row is the SAME two-line height in the
// in-flight, chips, empty and failed states, at 375 and at 320 wide with normal text, so nothing
// below it moves when suggestions load. Browse more sits on a line of its own under the chip strip.
// Every state is staged by answering the suggestions read in the browser (a GET; nothing reaches
// the backend and the form is never submitted). The chip names are ordinary ones that each fit a
// line: a name wider than the whole row still wraps inside its chip and makes the row taller while
// it shows, by the older D1 ruling, src/app/components/QuickSuggestions.js ("DECISION Phase 88.9-52 (R4 D1, owner 2026-11-18)").
const chip = (n: number, name: string, min: number, max: number) => ({
  id: `89618000-0000-4000-8000-0000000000a${n}`,
  name,
  thumbnail_url: null,
  min_players: min,
  max_players: max,
  playing_time: 45,
  weight: 2.2,
  owners: [] as string[],
  avg_group_rating: null,
  review_count: 0,
});
const ORDINARY_CHIPS = [chip(1, 'Catan', 3, 4), chip(2, 'Azul', 2, 4), chip(3, 'Wingspan', 1, 5), chip(4, 'Ticket to Ride', 2, 5), chip(5, 'Carcassonne', 2, 5)];

test('A-held (89.6-18): the suggestions row is one two-line height in the in-flight, chips, empty and failed states at 375 and 320', async ({ page }) => {
  type Answer = 'hold' | 'chips' | 'empty' | 'fail';
  const stage: { answer: Answer; release: () => void } = { answer: 'hold', release: () => {} };
  await page.route(SUGGESTIONS_REQUEST, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (stage.answer === 'hold') {
      // Held until the test releases it, then answered with the chips: the in-flight state and
      // the arrival of chips are read on ONE open dialog.
      await new Promise<void>((resolve) => {
        stage.release = resolve;
      });
    }
    try {
      if (stage.answer === 'fail') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic failure (89.6-18 e2e)' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: stage.answer === 'empty' ? [] : ORDINARY_CHIPS }) });
      }
    } catch {
      // The page moved on before a held read was answered: nothing to answer.
    }
  });

  const slot = dialog(page).getByTestId('quick-suggestions-slot');
  const below = dialog(page).getByRole('button', { name: /switch to manual entry/i });
  const open = async () => {
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await page.getByRole('button', { name: 'Create Event', exact: true }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    await expect(slot).toHaveCount(1);
    // R17: the dialog has stopped moving before any read of this open (the header note). The form
    // is already drawn here, so the opening animation is the one still running, if any is.
    await settleAnimations(dialog(page));
  };
  const read = async (what: string) => {
    const slotBox = await slot.boundingBox();
    const belowBox = await below.boundingBox();
    expect(slotBox, `${what}: the quick-suggestions slot has no layout box`).not.toBeNull();
    expect(belowBox, `${what}: the Switch to Manual Entry button below the row has no layout box`).not.toBeNull();
    return { height: slotBox!.height, left: slotBox!.x, belowTop: belowBox!.y };
  };

  for (const width of [375, 320]) {
    const at = `${width} wide`;
    await page.setViewportSize({ width, height: 667 });

    // In flight, then the chips arrive on the same open dialog.
    stage.answer = 'hold';
    await open();
    await expect(slot.getByTestId('quick-suggestions-placeholder'), `${at}: the in-flight bar never showed (the suggestions read was not held)`).toBeVisible();
    const pending = await read(`${at}, in flight`);
    stage.answer = 'chips';
    stage.release();
    const browseMore = slot.getByRole('button', { name: 'Browse more' });
    await expect(browseMore).toBeVisible();
    const chips = await read(`${at}, chips`);
    expect(chips.belowTop - pending.belowTop, `${at}: the form below the suggestions row moved when the chips arrived (${pending.belowTop} to ${chips.belowTop})`).toBe(0);

    // Browse more has a line of its own: it starts under the chip strip, at the row's left edge.
    const firstChip = slot.getByRole('button', { name: /^Catan/ });
    const chipBox = await firstChip.boundingBox();
    const browseBox = await browseMore.boundingBox();
    expect(chipBox, `${at}: the first chip has no layout box`).not.toBeNull();
    expect(browseBox, `${at}: Browse more has no layout box`).not.toBeNull();
    expect(browseBox!.y, `${at}: Browse more is not on a line of its own under the chips (chip bottom ${chipBox!.y + chipBox!.height}, Browse more top ${browseBox!.y})`).toBeGreaterThanOrEqual(chipBox!.y + chipBox!.height);
    expect(Math.abs(browseBox!.x - chips.left), `${at}: Browse more does not start at the row's left edge (row ${chips.left}, Browse more ${browseBox!.x})`).toBeLessThanOrEqual(1);
    for (const game of ORDINARY_CHIPS) {
      const box = await slot.getByRole('button', { name: new RegExp(`^${game.name}`) }).boundingBox();
      expect(box, `${at}: the "${game.name}" chip has no layout box`).not.toBeNull();
      expect(box!.height, `${at}: the "${game.name}" chip is not one 44px row (its name wrapped; pick a name that fits a line for this read)`).toBeLessThanOrEqual(45);
    }

    // The hint also shows before the read is sent, so wait for the answered read: this is the
    // SETTLED empty state, not the first frame.
    stage.answer = 'empty';
    const emptyAnswered = page.waitForResponse(SUGGESTIONS_REQUEST);
    await open();
    await emptyAnswered;
    await expect(slot.getByTestId('quick-suggestions-empty')).toBeVisible();
    const empty = await read(`${at}, empty`);

    stage.answer = 'fail';
    await open();
    await expect(slot.getByTestId('quick-suggestions-failed')).toBeVisible();
    const failed = await read(`${at}, failed`);

    const heights = { 'in flight': pending.height, chips: chips.height, empty: empty.height, failed: failed.height };
    const summary = Object.entries(heights).map(([state, height]) => `${state} ${height}`).join(', ');
    for (const [state, height] of Object.entries(heights)) {
      expect(Math.abs(height - chips.height), `${at}: the suggestions row is not one height in every state (${summary}); "${state}" differs from the chips state`).toBeLessThanOrEqual(0.5);
    }
    // Two lines: the chip row, the row gap and the Browse more row fit inside it.
    expect(chips.height, `${at}: the row is shorter than its two lines (${summary})`).toBeGreaterThanOrEqual(chipBox!.height + browseBox!.height);
    const tops = [pending.belowTop, chips.belowTop, empty.belowTop, failed.belowTop];
    expect(Math.max(...tops) - Math.min(...tops), `${at}: the form below the row does not start at one place in every state (${tops.join(', ')})`).toBeLessThanOrEqual(0.5);
  }
});
