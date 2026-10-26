// Plan 88.6.1-68 — the Create Event dialog after a request outlives it (Requirement 11).
//
// What this proves that jsdom cannot: in a real browser at 375px (the phone project) and at the
// journeys width, an Edit Event dialog reopened on the event page while the first update is still
// saving waits on its loading line (copy row E4) instead of showing the pre-update copy, then shows
// the SAVED value once that update settles, and the update's late success no longer closes it; its
// submit stays at least 44px tall inside the viewport. The ordinary path still closes, refreshes and
// says so. The red halves are ED1 (createEvent.participants.test.tsx) and GD-1
// (gameDetail/page.test.tsx) in jsdom; this spec runs in CI only (no local `.auth`).
//
// Shared-fixture rule: the fixture event and its group are READ-ONLY here. `holdWrites` is
// registered before the first navigation and holds every write this spec does not answer; the one
// PUT each test is about goes through `holdUntilReleased` (registered after it, so it runs first)
// and is answered in the browser. The spec's own routes are GET-only. No request or response body
// is logged, printed or attached.
// R3/R4 (the other hosts) reuse plan 71's `fillCreateEventManualEntry` and plan 20's `E2E_GROUP_ID`,
// and answer every write in the browser (`holdWrites` plus plan 44's `holdUntilReleased`).
import { test, expect, type Page } from '@playwright/test';

import { fillCreateEventManualEntry } from './support/createEvent';
import { E2E_GROUP_ID } from './support/groupSettings';
import { holdWrites, holdUntilReleased } from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';
import { scrubbedFetch } from './support/scrubbedFetch';

const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;
const EVENT_ID = new URL(E2E_EVENT_DETAIL_PATH, 'http://localhost').searchParams.get('event_id') ?? '1';
const EVENT_PATH = new RegExp(`/events/${EVENT_ID}$`);

const MARKER = 'E2E reopen check 88.6.1-68';
// Copy row E4 (ratified, D-30) — the Edit dialog's loading line.
const E4 = 'Loading game night...';

function editHeading(page: Page) {
  return page.getByRole('heading', { name: 'Edit Event', exact: true });
}

test.describe('Edit Event on the event page — reopening while an update is saving (88.6.1-68)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('R1: a reopened Edit dialog waits for the first update, then shows the saved value and stays open through its late success', async ({ page }) => {
    const net = await holdWrites(page);
    let released = false;
    // GET-only: once the update is released, the event read answers with the saved comment.
    await page.route(
      (url) => EVENT_PATH.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET' || !released) {
          await route.fallback();
          return;
        }
        const response = await scrubbedFetch(route);
        const json = await response.json();
        await route.fulfill({ response, json: { ...json, comments: MARKER } });
      },
    );
    const put = await holdUntilReleased(page, 'PUT', EVENT_PATH);

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    await expect(editHeading(page)).toBeVisible();
    const submit = page.getByTestId('create-event-submit');
    await expect(submit).toHaveText('Update Event');
    await page.getByRole('dialog').getByLabel('Comments').fill(MARKER);
    await submit.click();
    await put.arrived;
    expect(put.count()).toBe(1);

    await page.keyboard.press('Escape');
    await expect(editHeading(page)).toBeHidden();
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    await expect(editHeading(page)).toBeVisible();
    // Scoped to the dialog: the event page's own loader uses the same copy row.
    await expect(page.getByRole('dialog').getByText(E4, { exact: true })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('create-event-submit')).toHaveCount(0);

    released = true;
    await put.release({}, 200);

    await expect(page.getByText('Event updated', { exact: true })).toBeVisible();
    await expect(editHeading(page)).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Comments')).toHaveValue(MARKER);
    const reopened = page.getByTestId('create-event-submit');
    await expect(reopened).toHaveText('Update Event');
    await expect(reopened).not.toHaveAttribute('aria-disabled', 'true');
    await expectTouchTarget(reopened, 'the reopened submit', { axes: 'height', withinViewportOf: page });
    expect(put.count()).toBe(1);
    expect(net.count('PUT', /\/events\//)).toBe(0);
    expect(net.count('POST', /\/events/)).toBe(0);
    await page.keyboard.press('Escape');
  });

  test('R2: the ordinary update still closes the dialog, refreshes the page and says Event updated (confirm-only)', async ({ page }) => {
    await holdWrites(page);
    let readsAfterPut = 0;
    let put: Awaited<ReturnType<typeof holdUntilReleased>> | null = null;
    // GET-only: count the event reads that follow the PUT (the page's refresh).
    await page.route(
      (url) => EVENT_PATH.test(url.pathname),
      async (route) => {
        if (route.request().method() === 'GET' && put && put.count() >= 1) readsAfterPut += 1;
        await route.fallback();
      },
    );
    put = await holdUntilReleased(page, 'PUT', EVENT_PATH);
    await put.release({}, 200);

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    const submit = page.getByTestId('create-event-submit');
    await expect(submit).toHaveText('Update Event');
    await page.getByRole('dialog').getByLabel('Comments').fill(MARKER);
    await submit.click();
    await expect(editHeading(page)).toBeHidden();
    await expect(page.getByText('Event updated', { exact: true })).toBeVisible();
    await expect.poll(() => readsAfterPut).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1000);
    await expect(editHeading(page)).toBeHidden();
    expect(put.count()).toBe(1);
  });
});

function createHeading(page: Page) {
  return page.getByRole('heading', { name: 'Create Event', exact: true });
}

test.describe('Create Event — late success and the ordinary close at the other hosts (88.6.1-68)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('R3: groupHomePage — a reopened Create dialog keeps what was typed through the first create\'s late success (confirm-only)', async ({ page }) => {
    const net = await holdWrites(page);
    const resolve = await holdUntilReleased(page, 'POST', /\/games\/resolve$/);
    await resolve.release({ id: '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b' }, 200);
    const post = await holdUntilReleased(page, 'POST', /\/events$/);

    await page.goto('/groupHomePage?id=' + E2E_GROUP_ID);
    await fillCreateEventManualEntry(page);
    await page.getByTestId('create-event-submit').click();
    await post.arrived;
    expect(post.count()).toBe(1);

    await page.keyboard.press('Escape');
    await expect(createHeading(page)).toBeHidden();
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(createHeading(page)).toBeVisible();
    const submit = page.getByTestId('create-event-submit');
    await expect(submit).toBeVisible();
    const comments = page.getByRole('dialog').getByLabel('Comments');
    await comments.fill('second session');

    await post.release({}, 201);
    await expect(page.getByText('Event created', { exact: true })).toBeVisible();
    await expect(createHeading(page)).toBeVisible();
    await expect(comments).toHaveValue('second session');
    await expect(submit).toHaveText('Create Event');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Loading games...', { exact: true })).toHaveCount(0);
    expect(post.count()).toBe(1);
    expect(net.count('POST', /\/events$/)).toBe(0);
    await page.keyboard.press('Escape');
  });

  test('R4: groupPlanning — the email-link dialog creates, closes once and clears its parameters (confirm-only)', async ({ page }) => {
    await holdWrites(page);
    const post = await holdUntilReleased(page, 'POST', /\/events$/);
    await post.release({}, 201);
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

    await page.goto(
      '/groupPlanning?group_id=' + E2E_GROUP_ID + '&prefillDate=' + date + '&prefillTime=19:00&prefillDuration=120',
    );
    await expect(createHeading(page)).toBeVisible();
    await expect(page.getByLabel('Start Date & Time')).toHaveValue(date + 'T19:00');
    await page.getByTestId('create-event-submit').click();
    await expect(createHeading(page)).toBeHidden();
    await expect(page.getByText('Event created', { exact: true })).toBeVisible();
    // Phase 71.2 hotfix: the close clears the email-link parameters.
    await expect.poll(() => new URL(page.url()).searchParams.has('prefillDate')).toBe(false);
    await page.waitForTimeout(1000);
    await expect(createHeading(page)).toBeHidden();
    expect(post.count()).toBe(1);
  });
});
